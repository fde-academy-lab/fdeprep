/**
 * The write path.
 *
 * docs/03 section 9.2: the submission row, the cap decrement and the outbox
 * row are one transaction. Publishing happens later from the outbox, because
 * writing the row and then publishing leaves a gap where the row exists, the
 * message does not, and the submission hangs in queued forever.
 *
 * The gates are re-resolved here, inside that transaction, rather than trusted
 * from whatever the browser last rendered.
 */
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { inTransaction } from "../db/pool.ts";
import { consume, resolvePolicy, tierFor, type Difficulty } from "../policy/index.ts";

export { RateLimitError } from "../policy/caps.ts";

export type RunKind = "run" | "submit" | "live" | "rehearsal_submit" | "defence";

export class DuplicateSubmissionError extends Error {
  readonly status = 409;
  constructor() {
    super(
      "This is byte-identical to a submission you already made, so it was not counted. " +
      "Change something and submit again.",
    );
    this.name = "DuplicateSubmissionError";
  }
}

export class GateRefused extends Error {
  readonly status = 409;
  constructor(message: string) {
    super(message);
    this.name = "GateRefused";
  }
}

export interface CreateInput {
  enrolmentId: number;
  cohortId: number;
  problemId: number;
  kind: RunKind;
  body: string;
  /** Set on a submit inside a rehearsal sitting. */
  rehearsalId?: number;
}

export interface CreatedSubmission {
  id: number;
  attemptId: number;
  bodySha256: string;
}

/**
 * Which rolling window each kind spends.
 *
 * rehearsal_submit is absent on purpose. The sitting consumed the weekly
 * rehearsal allowance when it started, and charging it again on the first
 * problem would end the sitting after one answer. What bounds a rehearsal
 * submit instead is the one-per-problem rule below, from docs/00 section 7.4.
 */
const SCOPE_FOR = {
  run: "run_hourly", submit: "submit_daily",
  live: "live_daily",
  // The defence is asked only after a pass, so it never competes with the
  // submit cap. It still spends a model call, so it has a cap of its own.
  defence: "defence_daily",
} as const satisfies Partial<Record<RunKind, string>>;

export async function createSubmission(input: CreateInput): Promise<CreatedSubmission> {
  const bodySha256 = createHash("sha256").update(input.body, "utf8").digest("hex");

  return inTransaction(async (client) => {
    const { rows } = await client.query<{
      difficulty: Difficulty; version_id: string; artefact_type: string;
    }>(
      `select p.difficulty::text as difficulty, v.id as version_id,
              p.artefact_type::text as artefact_type
         from problem p join problem_version v
           on v.problem_id = p.id and v.version = p.current_version
        where p.id = $1`, [input.problemId]);
    const problem = rows[0];
    if (!problem) throw new Error(`problem ${input.problemId} has no current version`);

    const attemptId = await upsertAttempt(client, input);

    // A rehearsal submit spends no rolling-window allowance, because the
    // sitting paid for it when it started. That makes the kind worth checking
    // rather than trusting: named without a live sitting of the learner's own,
    // it would be an uncapped submit.
    if (input.kind === "rehearsal_submit") {
      const { rows: sitting } = await client.query(
        `select 1 from rehearsal
          where id = $1 and enrolment_id = $2 and finished_at is null and ends_at > now()`,
        [input.rehearsalId ?? 0, input.enrolmentId]);
      if (!sitting.length) {
        throw new GateRefused(
          "That rehearsal is not running, so this cannot be submitted as part of one. " +
          "Start a rehearsal from the rehearsal screen.");
      }
    }

    if (input.kind === "submit" || input.kind === "rehearsal_submit") {
      const policy = await resolvePolicy({
        enrolmentId: input.enrolmentId, problemId: input.problemId, client,
        rehearsal: input.kind === "rehearsal_submit",
      });

      // Degraded mode closes Submit and leaves Run alone. Checked here as well
      // as in the button, because the button is an affordance and this is the
      // boundary.
      if (policy.degraded.on) throw new GateRefused(policy.submit.reason!);

      // docs/00 section 7.4: one submit each. A sitting where a learner can
      // resubmit until something passes measures persistence, not judgement.
      if (input.rehearsalId) {
        const already = await client.query(
          `select 1 from submission s
             join problem_version v on v.id = s.problem_version_id
            where s.rehearsal_id = $1 and v.problem_id = $2 limit 1`,
          [input.rehearsalId, input.problemId]);
        if (already.rows.length) {
          throw new GateRefused(
            "You have already submitted this problem in this rehearsal. A rehearsal allows " +
            "one submit per problem.");
        }
      }
      // The learner-test gate is checked before the cap, so an Extreme learner
      // who has written no test is told that rather than losing their one
      // daily attempt to a message about caps.
      if (!policy.submit.allowed && policy.learnerTests.required &&
          !policy.learnerTests.withAssertion) {
        throw new GateRefused(policy.submit.reason!);
      }

      // Before the cap decrements: an identical resubmission is rejected by
      // hash, so a learner who resubmits the same bytes on Extreme keeps their
      // attempt (docs/02 section 4).
      if (tierFor(problem.difficulty).rejectsDuplicateSubmissions) {
        const duplicate = await client.query(
          `select 1 from submission where attempt_id = $1 and body_sha256 = $2 limit 1`,
          [attemptId, bodySha256]);
        if (duplicate.rows.length) throw new DuplicateSubmissionError();
      }
    }

    if (input.kind === "defence") {
      // docs/03 section 4.4: the defence is asked after a pass. Checking here
      // rather than only in the UI keeps a hand-rolled request from scoring a
      // defence for a problem the learner never solved.
      const policy = await resolvePolicy({
        enrolmentId: input.enrolmentId, problemId: input.problemId, client,
      });
      if (!policy.defence.open) {
        throw new GateRefused(policy.defence.reason ??
          "This problem has no defence step.");
      }
    }

    // Only now is the allowance spent. Everything above either throws, which
    // rolls the transaction back whole, or passes.
    const scope = SCOPE_FOR[input.kind as keyof typeof SCOPE_FOR];
    if (scope) {
      await consume(client, {
        enrolmentId: input.enrolmentId,
        problemId: input.problemId,
        difficulty: problem.difficulty,
        scope,
      });
    }

    const { rows: created } = await client.query<{ id: string }>(
      `insert into submission (attempt_id, problem_version_id, kind, body, body_sha256,
                               rehearsal_id)
       values ($1, $2, $3::run_kind, $4, $5, $6) returning id`,
      [attemptId, problem.version_id, input.kind, input.body, bodySha256,
       input.rehearsalId ?? null]);
    const submissionId = Number(created[0]!.id);

    if (input.kind === "submit") {
      await client.query(
        "update attempt set submit_count = submit_count + 1 where id = $1", [attemptId]);
    }

    await client.query(
      `insert into outbox (submission_id, payload) values ($1, $2)`,
      [submissionId, JSON.stringify({
        submission_id: submissionId,
        problem_version_id: Number(problem.version_id),
        kind: input.kind,
        artefact_type: input.kind === "defence" ? "defence" : problem.artefact_type,
        body_sha256: bodySha256,
      })]);

    return { id: submissionId, attemptId, bodySha256 };
  });
}

async function upsertAttempt(client: PoolClient, input: CreateInput): Promise<number> {
  const { rows } = await client.query<{ id: string }>(
    `insert into attempt (enrolment_id, problem_id, cohort_id)
     values ($1, $2, $3)
     on conflict (enrolment_id, problem_id) do update set problem_id = excluded.problem_id
     returning id`,
    [input.enrolmentId, input.problemId, input.cohortId]);
  return Number(rows[0]!.id);
}
