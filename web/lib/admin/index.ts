/**
 * The admin actions behind screen S10.
 *
 * docs/02 section 9: log every persona change, cap override, problem publish
 * and roster edit. Every function here writes its audit row in the same
 * transaction as the change, so a change cannot land without its reason
 * attached, and the actor is a parameter rather than something read from a
 * request inside here.
 */
import type { Pool, PoolClient } from "pg";
import { db, inTransaction } from "../db/pool.ts";
import { send } from "../queue/shim.ts";
import { setDegradedMode, type DegradedMode } from "../policy/settings.ts";
import type { Persona } from "../policy/roadmap.ts";
import type { Scope } from "../policy/caps.ts";

export const PERSONAS: readonly Persona[] = ["builder", "navigator", "accelerator"];

export class ReasonRequired extends Error {
  readonly status = 400;
  constructor(what: string) {
    super(`${what} needs a reason. It is written to the audit log and it is the only ` +
          "record of why this happened.");
    this.name = "ReasonRequired";
  }
}

export class NotApplicable extends Error {
  readonly status = 409;
}

async function audit(
  client: Pool | PoolClient, actorId: number, action: string, target: string,
  detail: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `insert into audit_log (actor_id, action, target, detail) values ($1, $2, $3, $4)`,
    [actorId, action, target, JSON.stringify(detail)]);
}

function required(reason: string | null | undefined, what: string): string {
  const trimmed = (reason ?? "").trim();
  if (!trimmed) throw new ReasonRequired(what);
  return trimmed;
}

/* ------------------------------------------------------------------ roster */

export interface RosterRow {
  enrolmentId: number;
  userId: number;
  login: string;
  displayName: string;
  persona: Persona;
  role: string;
  state: string;
  lastActivity: string | null;
}

export async function roster(
  cohortId: number, client: Pool | PoolClient = db(),
): Promise<RosterRow[]> {
  const { rows } = await client.query<{
    enrolment_id: string; user_id: string; login: string; display_name: string;
    persona: Persona; role: string; state: string; last_activity: Date | null;
  }>(
    `select e.id as enrolment_id, u.id as user_id, u.github_login as login,
            u.display_name, e.persona::text as persona, e.role::text as role,
            e.state::text as state,
            (select max(s.queued_at) from submission s
               join attempt a on a.id = s.attempt_id
              where a.enrolment_id = e.id) as last_activity
       from enrolment e join app_user u on u.id = e.user_id
      where e.cohort_id = $1
      order by u.github_login`, [cohortId]);

  return rows.map((row) => ({
    enrolmentId: Number(row.enrolment_id),
    userId: Number(row.user_id),
    login: row.login,
    displayName: row.display_name,
    persona: row.persona,
    role: row.role,
    state: row.state,
    lastActivity: row.last_activity ? row.last_activity.toISOString() : null,
  }));
}

export interface PersonaCsvRow {
  login: string;
  persona: Persona;
}

/**
 * Read a persona CSV.
 *
 * Column order is not fixed, because the file comes out of whatever the cohort
 * tracker exports. A bad row is reported by line and the rest of the file still
 * applies: rejecting 180 rows because one says "wizard" makes the operator
 * edit a spreadsheet at the exact moment they are trying to fix something.
 */
export function parsePersonaCsv(text: string): { rows: PersonaCsvRow[]; errors: string[] } {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return { rows: [], errors: ["The file is empty."] };

  const header = splitCsvLine(lines[0]!).map((cell) => cell.trim().toLowerCase());
  const loginAt = header.indexOf("login");
  const personaAt = header.indexOf("persona");
  if (loginAt === -1 || personaAt === -1) {
    return { rows: [], errors: ["The header needs a login column and a persona column."] };
  }

  const rows: PersonaCsvRow[] = [];
  const errors: string[] = [];

  for (const [index, line] of lines.slice(1).entries()) {
    const cells = splitCsvLine(line);
    const login = (cells[loginAt] ?? "").trim();
    const persona = (cells[personaAt] ?? "").trim().toLowerCase();
    const at = `line ${index + 2}`;

    if (!login) { errors.push(`${at}: no login.`); continue; }
    if (!PERSONAS.includes(persona as Persona)) {
      errors.push(`${at}: ${persona || "(blank)"} is not a persona. ` +
                  `Use one of ${PERSONAS.join(", ")}.`);
      continue;
    }
    rows.push({ login, persona: persona as Persona });
  }

  return { rows, errors };
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]!;
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { out.push(field); field = ""; }
    else field += char;
  }
  out.push(field);
  return out;
}

export interface PersonaApplyResult {
  changed: number;
  unchanged: number;
  errors: string[];
}

export async function applyPersonaCsv(
  rows: PersonaCsvRow[], options: { actorId: number; cohortId: number },
): Promise<PersonaApplyResult> {
  return inTransaction(async (client) => {
    const result: PersonaApplyResult = { changed: 0, unchanged: 0, errors: [] };

    for (const row of rows) {
      const { rows: found } = await client.query<{ id: string; persona: Persona }>(
        `select e.id, e.persona::text as persona
           from enrolment e join app_user u on u.id = e.user_id
          where e.cohort_id = $1 and lower(u.github_login) = lower($2)`,
        [options.cohortId, row.login]);
      const enrolment = found[0];

      if (!enrolment) {
        // Never create an enrolment from a CSV. docs/00: offboarding is
        // removing someone from the GitHub organisation, and a second user
        // list that a spreadsheet can grow is exactly the drift that avoids.
        result.errors.push(`${row.login} is not enrolled in this cohort, so nothing changed.`);
        continue;
      }
      if (enrolment.persona === row.persona) { result.unchanged += 1; continue; }

      await client.query(
        "update enrolment set persona = $2::persona where id = $1",
        [enrolment.id, row.persona]);
      await client.query(
        `insert into persona_change (enrolment_id, from_persona, to_persona, changed_by)
         values ($1, $2::persona, $3::persona, $4)`,
        [enrolment.id, enrolment.persona, row.persona, options.actorId]);
      await audit(client, options.actorId, "persona.change", row.login,
        { from: enrolment.persona, to: row.persona, enrolment_id: Number(enrolment.id) });
      result.changed += 1;
    }

    return result;
  });
}

/* ------------------------------------------------------------------- ops */

export async function toggleDegradedMode(
  on: boolean, reason: string | null, actorId: number,
): Promise<DegradedMode> {
  const stated = on ? required(reason, "Turning on degraded mode") : null;

  return inTransaction(async (client) => {
    await setDegradedMode(client, on, stated, actorId);
    await audit(client, actorId, "platform.degraded_mode", "degraded_mode",
      { on, reason: stated });
    return { on, reason: stated, since: new Date().toISOString() };
  });
}

/**
 * The requeue from the docs/05 runbook.
 *
 * "It writes a fresh message and does not consume the learner's cap." The cap
 * was spent when the submission was created and the submission is still alive,
 * so there is nothing to refund: this only re-publishes.
 */
export async function requeueSubmission(
  submissionId: number, reason: string, actorId: number,
): Promise<void> {
  const stated = required(reason, "Requeueing a submission");

  await inTransaction(async (client) => {
    const { rows } = await client.query<{
      verdict: string | null; kind: string; artefact_type: string;
      problem_version_id: string; body_sha256: string;
    }>(
      `select s.verdict::text, s.kind::text, s.problem_version_id, s.body_sha256,
              p.artefact_type::text as artefact_type
         from submission s
         join problem_version v on v.id = s.problem_version_id
         join problem p on p.id = v.problem_id
        where s.id = $1 for update`, [submissionId]);
    const row = rows[0];
    if (!row) throw new NotApplicable(`Submission ${submissionId} does not exist.`);
    if (row.verdict !== null) {
      throw new NotApplicable(
        `Submission ${submissionId} already reached a verdict of ${row.verdict}, so there is ` +
        "nothing stuck to requeue.");
    }

    // An unsent outbox row means the dispatcher has not run, not that the
    // message was lost. Adding a second row there would run the submission
    // twice, so this only re-publishes what is already waiting.
    const { rows: waiting } = await client.query(
      "select 1 from outbox where submission_id = $1 and sent_at is null limit 1",
      [submissionId]);

    // Straight back through the outbox, so the dispatcher issues a fresh lease
    // and fencing token exactly as it would for a new submission. A message
    // written by hand here would carry a stale token and lose the compare-and-set.
    if (!waiting.length) await client.query(
      `insert into outbox (submission_id, payload) values ($1, $2)`,
      [submissionId, JSON.stringify({
        submission_id: submissionId,
        problem_version_id: Number(row.problem_version_id),
        kind: row.kind,
        artefact_type: row.kind === "defence" ? "defence" : row.artefact_type,
        body_sha256: row.body_sha256,
        requeued_by: actorId,
      })]);

    await client.query(
      `update submission set status = 'queued', lease_token = null, fencing_token = null,
                             lease_expires_at = null
        where id = $1`, [submissionId]);

    await audit(client, actorId, "submission.requeue", String(submissionId),
      { reason: stated, kind: row.kind, republished: waiting.length > 0 });
  });

  // Published outside the transaction that wrote the outbox row, the same way
  // the dispatcher does it, so a rollback cannot leave a message behind.
  const { dispatchOnce } = await import("../queue/dispatcher.ts");
  await dispatchOnce();
  void send;
}

export interface CounterTarget {
  enrolmentId: number;
  scope: Scope;
  problemId?: number;
}

/**
 * The counter clear from the docs/05 runbook.
 *
 * "An admin can clear the counter row for that learner, scope and window. Log
 * the reason; the audit trail is the point."
 */
export async function clearCounter(
  target: CounterTarget, reason: string, actorId: number,
): Promise<number> {
  const stated = required(reason, "Clearing a rate limit counter");

  return inTransaction(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `delete from rate_limit_counter
        where enrolment_id = $1 and scope = $2::limit_scope
          and ($3::bigint is null or problem_id = $3::bigint)
        returning id`,
      [target.enrolmentId, target.scope, target.problemId ?? null]);

    await audit(client, actorId, "cap.clear", String(target.enrolmentId),
      { reason: stated, scope: target.scope, problem_id: target.problemId ?? null,
        rows_cleared: rows.length });
    return rows.length;
  });
}
