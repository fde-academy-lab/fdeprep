/**
 * The write path from docs/03 section 9.2.
 *
 * The submission row, the cap decrement and the outbox row are one
 * transaction. Publishing to the queue happens later, from the outbox, because
 * writing the row and then publishing leaves a gap where the row exists, the
 * message does not, and the submission hangs in queued forever.
 */
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { inTransaction } from "../db/pool.ts";
import { rejectsDuplicateSubmissions, type Difficulty } from "../policy/difficulty.ts";

export type RunKind = "run" | "submit" | "live" | "rehearsal_submit";

export class RateLimitError extends Error {
  constructor(readonly scope: string, readonly max: number, readonly retryAfterS: number) {
    super(
      `You have used your ${max} ${scope.replace("_", " ")} allowance. ` +
      `It resets in ${Math.ceil(retryAfterS / 60)} minutes.`,
    );
    this.name = "RateLimitError";
  }
}

export class DuplicateSubmissionError extends Error {
  constructor() {
    super("This is byte-identical to your last submission, so it was not counted. Change something and submit again.");
    this.name = "DuplicateSubmissionError";
  }
}

export interface CreateInput {
  enrolmentId: number;
  cohortId: number;
  problemId: number;
  kind: RunKind;
  body: string;
}

export interface CreatedSubmission {
  id: number;
  attemptId: number;
  bodySha256: string;
}

const SCOPE_FOR: Record<RunKind, string> = {
  run: "run_hourly",
  submit: "submit_daily",
  live: "live_daily",
  rehearsal_submit: "rehearsal_weekly",
};

export async function createSubmission(input: CreateInput): Promise<CreatedSubmission> {
  const bodySha256 = createHash("sha256").update(input.body, "utf8").digest("hex");

  return inTransaction(async (client) => {
    const { rows: problemRows } = await client.query<{
      difficulty: string; version_id: string;
    }>(
      `select p.difficulty::text, v.id as version_id
         from problem p join problem_version v
           on v.problem_id = p.id and v.version = p.current_version
        where p.id = $1`, [input.problemId]);
    const problem = problemRows[0];
    if (!problem) throw new Error(`problem ${input.problemId} has no current version`);

    const attemptId = await upsertAttempt(client, input);

    // An identical resubmission is rejected before the cap is spent. The
    // policy module decides which tiers that applies to; nothing here reads
    // difficulty to answer it.
    if (input.kind === "submit"
        && rejectsDuplicateSubmissions(problem.difficulty as Difficulty)) {
      const { rows } = await client.query(
        `select 1 from submission where attempt_id = $1 and body_sha256 = $2 limit 1`,
        [attemptId, bodySha256]);
      if (rows.length) throw new DuplicateSubmissionError();
    }

    await consumeAllowance(client, input, problem.difficulty);

    const { rows: submissionRows } = await client.query<{ id: string }>(
      `insert into submission (attempt_id, problem_version_id, kind, body, body_sha256)
       values ($1, $2, $3::run_kind, $4, $5) returning id`,
      [attemptId, problem.version_id, input.kind, input.body, bodySha256]);
    const submissionId = Number(submissionRows[0]!.id);

    if (input.kind === "submit") {
      await client.query(
        "update attempt set submit_count = submit_count + 1 where id = $1", [attemptId]);
    }

    // Same transaction. This is the whole point of the outbox.
    await client.query(
      `insert into outbox (submission_id, payload) values ($1, $2)`,
      [submissionId, JSON.stringify({
        submission_id: submissionId,
        problem_version_id: Number(problem.version_id),
        kind: input.kind,
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

/**
 * Increment the rolling window counter, refusing when the policy is spent.
 * The row is locked for the length of the transaction, so two concurrent
 * submissions cannot both see the last remaining slot.
 */
async function consumeAllowance(
  client: PoolClient, input: CreateInput, difficulty: string,
): Promise<void> {
  const scope = SCOPE_FOR[input.kind];
  const { rows: policyRows } = await client.query<{ max_count: number; window_s: number }>(
    `select max_count, window_s from rate_limit_policy
      where scope = $1::limit_scope
        and (difficulty is null or difficulty::text = $2)
      order by difficulty nulls last limit 1`,
    [scope, difficulty]);
  const policy = policyRows[0];
  if (!policy) return;

  const problemScoped = scope === "submit_daily" || scope === "run_hourly";
  const problemId = problemScoped ? input.problemId : null;

  // The window is rolling, so one row stays open for the length of the window
  // and is expired by a nightly job. Keying a row per second would fragment
  // one allowance across dozens of rows and no cap would ever bind.
  // `for update` holds it for the transaction, so two concurrent submissions
  // cannot both claim the last slot.
  const { rows: open } = await client.query<{ id: string; count: number }>(
    `select id, count from rate_limit_counter
      where enrolment_id = $1 and scope = $2::limit_scope
        and problem_id is not distinct from $3
        and window_start > now() - make_interval(secs => $4)
      order by window_start desc limit 1
      for update`,
    [input.enrolmentId, scope, problemId, policy.window_s]);

  const current = open[0];
  if ((current?.count ?? 0) >= policy.max_count) {
    throw new RateLimitError(scope, policy.max_count, policy.window_s);
  }

  if (current) {
    await client.query(
      "update rate_limit_counter set count = count + 1 where id = $1", [current.id]);
  } else {
    await client.query(
      `insert into rate_limit_counter (enrolment_id, scope, problem_id, window_start, count)
       values ($1, $2::limit_scope, $3, now(), 1)`,
      [input.enrolmentId, scope, problemId]);
  }
}

/**
 * docs/03 section 8: an error verdict never consumes an allowance. Called by
 * the result writer when a terminal verdict comes back as error or timeout.
 */
export async function refundAllowance(
  client: PoolClient, submissionId: number,
): Promise<void> {
  await client.query(
    `update rate_limit_counter c
        set count = greatest(0, c.count - 1)
       from submission s
       join attempt a on a.id = s.attempt_id
       join problem_version v on v.id = s.problem_version_id
      where s.id = $1
        and c.enrolment_id = a.enrolment_id
        and c.scope = (case s.kind
              when 'run' then 'run_hourly'
              when 'submit' then 'submit_daily'
              when 'live' then 'live_daily'
              else 'rehearsal_weekly' end)::limit_scope
        and c.problem_id is not distinct from (
              case when s.kind in ('run','submit') then v.problem_id else null end)
        and c.count > 0`,
    [submissionId]);
}
