/**
 * The ladder's gated actions.
 *
 * Every one of these re-resolves the policy inside the transaction that
 * writes, so a gate cannot be passed by a stale render. The browser never
 * supplies an enrolment, a difficulty or an allowance; all three come from the
 * session and the database.
 */
import type { PoolClient } from "pg";
import { inTransaction } from "../db/pool.ts";
import { hasAssertion, resolvePolicy, type Decision } from "../policy/index.ts";

export class GateError extends Error {
  readonly status = 409;
  constructor(message: string) {
    super(message);
    this.name = "GateError";
  }
}

async function attemptId(
  client: PoolClient, enrolmentId: number, cohortId: number, problemId: number,
): Promise<number> {
  const { rows } = await client.query<{ id: string }>(
    `insert into attempt (enrolment_id, problem_id, cohort_id)
     values ($1, $2, $3)
     on conflict (enrolment_id, problem_id) do update set problem_id = excluded.problem_id
     returning id`,
    [enrolmentId, problemId, cohortId]);
  return Number(rows[0]!.id);
}

export interface RevealedHint {
  ordinal: number;
  bodyMd: string;
  remaining: number;
}

/**
 * docs/00 section 3.2: hints are revealed one at a time, and every reveal is
 * written to the attempt record and shown to faculty.
 */
export async function revealHint(options: {
  enrolmentId: number; cohortId: number; problemId: number;
}): Promise<RevealedHint> {
  return inTransaction(async (client) => {
    const policy = await resolvePolicy({ ...options, client });
    if (!policy.hints.allowed) {
      throw new GateError(policy.hints.reason ?? "Hints are not available yet.");
    }

    const id = await attemptId(client, options.enrolmentId, options.cohortId, options.problemId);
    const ordinal = policy.hints.nextOrdinal!;

    const { rows } = await client.query<{ id: string; body_md: string }>(
      `select h.id, h.body_md from hint h
         join problem_version v on v.id = h.problem_version_id
         join problem p on p.id = v.problem_id and p.current_version = v.version
        where p.id = $1 and h.ordinal = $2`,
      [options.problemId, ordinal]);
    const hint = rows[0];
    if (!hint) throw new GateError("That hint does not exist on this problem.");

    // The unique constraint makes a double-click idempotent rather than a
    // second charge against the learner's record.
    const inserted = await client.query(
      `insert into hint_reveal (attempt_id, hint_id) values ($1, $2)
       on conflict (attempt_id, hint_id) do nothing returning id`,
      [id, hint.id]);

    if (inserted.rows.length) {
      await client.query(
        "update attempt set hints_used = hints_used + 1 where id = $1", [id]);
      await client.query(
        `insert into audit_log (action, target, detail)
         values ('hint.reveal', $1, $2)`,
        [`problem:${options.problemId}`,
         JSON.stringify({ attempt_id: id, ordinal, enrolment_id: options.enrolmentId })]);
    }

    return {
      ordinal,
      bodyMd: hint.body_md,
      remaining: Math.max(0, policy.hints.total - ordinal),
    };
  });
}

/**
 * The Hard attempt note. Deliberate friction: it produces text a faculty
 * member can read to see whether the learner is stuck on the concept or on
 * Python (docs/00 section 3.2).
 */
export async function saveAttemptNote(options: {
  enrolmentId: number; cohortId: number; problemId: number; note: string;
}): Promise<Decision> {
  return inTransaction(async (client) => {
    const id = await attemptId(client, options.enrolmentId, options.cohortId, options.problemId);
    await client.query(
      "update attempt set attempt_note = $2 where id = $1", [id, options.note]);
    return resolvePolicy({ ...options, client });
  });
}

/** Extreme stores the learner's own tests, written before they may submit. */
export async function saveLearnerTest(options: {
  enrolmentId: number; cohortId: number; problemId: number; body: string;
}): Promise<{ accepted: boolean; withAssertion: boolean; reason: string | null }> {
  return inTransaction(async (client) => {
    if (!options.body.trim()) {
      throw new GateError("An empty test does not say what you expect. Write one assertion.");
    }
    const id = await attemptId(client, options.enrolmentId, options.cohortId, options.problemId);
    await client.query(
      "insert into learner_test (attempt_id, body) values ($1, $2)", [id, options.body]);

    const withAssertion = hasAssertion(options.body);
    return {
      accepted: true,
      withAssertion,
      reason: withAssertion
        ? null
        : "Saved, but this test asserts nothing, so Submit stays closed. Add an assert.",
    };
  });
}

/**
 * Give up. L5 unlocks, and the choice is recorded, because an unlocked
 * walkthrough with no record of why looks identical to a pass in the data.
 */
export async function giveUp(options: {
  enrolmentId: number; cohortId: number; problemId: number; reason?: string;
}): Promise<Decision> {
  return inTransaction(async (client) => {
    const policy = await resolvePolicy({ ...options, client });
    if (!policy.giveUp.allowed) {
      throw new GateError(policy.giveUp.reason ?? "You cannot give up on this problem.");
    }

    const id = await attemptId(client, options.enrolmentId, options.cohortId, options.problemId);
    await client.query(
      `update attempt set gave_up_at = now(), gave_up_reason = $2 where id = $1`,
      [id, options.reason ?? null]);
    await client.query(
      `insert into audit_log (action, target, detail) values ('attempt.give_up', $1, $2)`,
      [`problem:${options.problemId}`,
       JSON.stringify({ attempt_id: id, enrolment_id: options.enrolmentId,
                        reason: options.reason ?? null })]);

    return resolvePolicy({ ...options, client });
  });
}

/** L5, gated on a pass or a recorded give-up. */
export async function referenceWalkthrough(options: {
  enrolmentId: number; problemId: number;
}): Promise<{ unlocked: boolean; referenceMd: string | null; reason: string | null }> {
  const policy = await resolvePolicy(options);
  if (!policy.layers.reference) {
    return {
      unlocked: false, referenceMd: null,
      reason: "The walkthrough unlocks when you pass, or when you give up and say so.",
    };
  }
  const { db } = await import("../db/pool.ts");
  const { rows } = await db().query<{ reference_md: string | null }>(
    `select v.reference_md from problem p
       join problem_version v on v.problem_id = p.id and v.version = p.current_version
      where p.id = $1`, [options.problemId]);
  return { unlocked: true, referenceMd: rows[0]?.reference_md ?? null, reason: null };
}
