/**
 * Rolling-window rate limits against rate_limit_counter.
 *
 * docs/00 section 4: every cap resets on a rolling window rather than at a
 * fixed clock hour, so a learner in a different time zone is not
 * disadvantaged. One counter row stays open for the length of the window and a
 * nightly job expires it; a row per tick would fragment one allowance across
 * many rows and no cap would ever bind.
 *
 * All limits are rows in rate_limit_policy, editable by an admin without a
 * deploy, so nothing here hard-codes a number.
 */
import type { Pool, PoolClient } from "pg";
import { db } from "../db/pool.ts";
import type { Difficulty } from "./tiers.ts";

export type Scope = "run_hourly" | "submit_daily" | "live_daily" | "rehearsal_weekly";

/** Scopes counted per problem rather than per account. */
const PER_PROBLEM: ReadonlySet<Scope> = new Set(["run_hourly", "submit_daily"]);

export interface Allowance {
  scope: Scope;
  /** Null when no policy row exists, which means no cap applies. */
  max: number | null;
  used: number;
  remaining: number;
  /** Seconds until the open window expires, or null when nothing is counted yet. */
  resetInS: number | null;
  windowS: number;
}

export function problemScoped(scope: Scope): boolean {
  return PER_PROBLEM.has(scope);
}

export async function policyRow(
  client: Pool | PoolClient, scope: Scope, difficulty: Difficulty,
): Promise<{ max_count: number; window_s: number } | null> {
  const { rows } = await client.query<{ max_count: number; window_s: number }>(
    `select max_count, window_s from rate_limit_policy
      where scope = $1::limit_scope
        and (difficulty is null or difficulty::text = $2)
      order by difficulty nulls last
      limit 1`,
    [scope, difficulty]);
  return rows[0] ?? null;
}

/** What is left, without consuming anything. Safe to call on a render path. */
export async function allowanceFor(options: {
  enrolmentId: number;
  problemId: number;
  difficulty: Difficulty;
  scope: Scope;
  client?: Pool | PoolClient;
}): Promise<Allowance> {
  const client = options.client ?? db();
  const policy = await policyRow(client, options.scope, options.difficulty);
  if (!policy) {
    return {
      scope: options.scope, max: null, used: 0, remaining: Number.POSITIVE_INFINITY,
      resetInS: null, windowS: 0,
    };
  }

  const { rows } = await client.query<{ count: number; reset_in_s: number }>(
    `select count,
            ceil(extract(epoch from (window_start + make_interval(secs => $4) - now())))::int
              as reset_in_s
       from rate_limit_counter
      where enrolment_id = $1 and scope = $2::limit_scope
        and problem_id is not distinct from $3
        and window_start > now() - make_interval(secs => $4)
      order by window_start desc
      limit 1`,
    [options.enrolmentId, options.scope,
     problemScoped(options.scope) ? options.problemId : null, policy.window_s]);

  const used = rows[0]?.count ?? 0;
  return {
    scope: options.scope,
    max: policy.max_count,
    used,
    remaining: Math.max(0, policy.max_count - used),
    resetInS: rows[0]?.reset_in_s ?? null,
    windowS: policy.window_s,
  };
}

export class RateLimitError extends Error {
  readonly status = 429;
  constructor(readonly scope: Scope, readonly max: number, readonly resetInS: number) {
    super(describeExhausted(scope, max, resetInS));
    this.name = "RateLimitError";
  }
}

/**
 * Claim one unit of the allowance, or throw. The counter row is locked for the
 * transaction, so two concurrent submissions cannot both take the last slot.
 *
 * Must run inside the same transaction as the submission row and the outbox
 * row, so a refused cap leaves nothing behind.
 */
export async function consume(client: PoolClient, options: {
  enrolmentId: number;
  problemId: number;
  difficulty: Difficulty;
  scope: Scope;
}): Promise<Allowance> {
  const policy = await policyRow(client, options.scope, options.difficulty);
  if (!policy) {
    return {
      scope: options.scope, max: null, used: 0, remaining: Number.POSITIVE_INFINITY,
      resetInS: null, windowS: 0,
    };
  }

  const problemId = problemScoped(options.scope) ? options.problemId : null;

  const { rows: open } = await client.query<{ id: string; count: number; reset_in_s: number }>(
    `select id, count,
            ceil(extract(epoch from (window_start + make_interval(secs => $4) - now())))::int
              as reset_in_s
       from rate_limit_counter
      where enrolment_id = $1 and scope = $2::limit_scope
        and problem_id is not distinct from $3
        and window_start > now() - make_interval(secs => $4)
      order by window_start desc
      limit 1
      for update`,
    [options.enrolmentId, options.scope, problemId, policy.window_s]);

  const current = open[0];
  if ((current?.count ?? 0) >= policy.max_count) {
    throw new RateLimitError(
      options.scope, policy.max_count, current?.reset_in_s ?? policy.window_s);
  }

  if (current) {
    await client.query(
      "update rate_limit_counter set count = count + 1 where id = $1", [current.id]);
  } else {
    // Two transactions can reach this line together on a first use. The unique
    // index settles it and the loser retries against the row the winner made.
    const inserted = await client.query(
      `insert into rate_limit_counter (enrolment_id, scope, problem_id, window_start, count)
       values ($1, $2::limit_scope, $3, now(), 1)
       on conflict (enrolment_id, scope, problem_id, window_start) do nothing
       returning id`,
      [options.enrolmentId, options.scope, problemId]);
    if (!inserted.rows.length) {
      return consume(client, options);
    }
  }

  const used = (current?.count ?? 0) + 1;
  return {
    scope: options.scope,
    max: policy.max_count,
    used,
    remaining: Math.max(0, policy.max_count - used),
    resetInS: current?.reset_in_s ?? policy.window_s,
    windowS: policy.window_s,
  };
}

/**
 * docs/03 section 8: an error verdict never consumes an allowance. A learner
 * who loses their one daily Extreme attempt to infrastructure stops trusting
 * every score.
 */
export async function refund(client: PoolClient, submissionId: number): Promise<void> {
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

function describeExhausted(scope: Scope, max: number, resetInS: number): string {
  const when = humanise(resetInS);
  switch (scope) {
    case "run_hourly":
      return `You have used all ${max} runs this hour. More in ${when}.`;
    case "submit_daily":
      return max === 1
        ? `Extreme allows one submit per problem per day. Your next attempt is in ${when}.`
        : `You have used all ${max} submits on this problem today. More in ${when}.`;
    case "live_daily":
      return `You have used all ${max} live runs today. More in ${when}.`;
    case "rehearsal_weekly":
      return `You have used all ${max} rehearsals this week. More in ${when}.`;
  }
}

export function humanise(seconds: number): string {
  if (seconds <= 60) return "under a minute";
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? "an hour" : `${hours} hours`;
}
