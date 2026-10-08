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

export type Scope =
  | "run_hourly" | "submit_daily" | "live_daily" | "rehearsal_weekly"
  | "defence_daily" | "voice_guided_daily" | "voice_unguided_daily";

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

/**
 * The policy row for a scope. `difficulty` is left out for the scopes that
 * are not tiered, such as the voice caps, and then only a row with no
 * difficulty matches.
 */
export async function policyRow(
  client: Pool | PoolClient, scope: Scope, difficulty?: Difficulty,
): Promise<{ max_count: number; window_s: number } | null> {
  const { rows } = await client.query<{ max_count: number; window_s: number }>(
    `select max_count, window_s from rate_limit_policy
      where scope = $1::limit_scope
        and (difficulty is null or difficulty::text = $2)
      order by difficulty nulls last
      limit 1`,
    [scope, difficulty ?? null]);
  return rows[0] ?? null;
}

/**
 * What is left, without consuming anything. Safe to call on a render path.
 *
 * `problemId` is optional because only some scopes are counted per problem.
 * Asking for a problem-scoped allowance without one is a mistake rather than a
 * default, so it throws instead of quietly counting the whole account.
 */
export async function allowanceFor(options: {
  enrolmentId: number;
  problemId?: number;
  difficulty?: Difficulty;
  scope: Scope;
  client?: Pool | PoolClient;
}): Promise<Allowance> {
  const client = options.client ?? db();
  if (problemScoped(options.scope) && options.problemId === undefined) {
    throw new Error(`${options.scope} is counted per problem, so it needs a problemId.`);
  }
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
  problemId?: number;
  difficulty?: Difficulty;
  scope: Scope;
}): Promise<Allowance> {
  if (problemScoped(options.scope) && options.problemId === undefined) {
    throw new Error(`${options.scope} is counted per problem, so it needs a problemId.`);
  }
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
 * Give back one unit that was claimed at `at`, from the window open then.
 *
 * For a claim that turns out not to count, such as a voice answer abandoned
 * before it said anything (docs/07 section 12, item 9). Scoped to the window
 * the claim went into, so a unit claimed yesterday is never handed back out
 * of today's allowance. A window that has already closed has nothing left to
 * give back, and the learner lost nothing, because it reset.
 *
 * `at` has been through a JavaScript Date, which keeps milliseconds, while the
 * window's start keeps the microseconds Postgres wrote. A claim made in the
 * same transaction as the window opens at the same instant, so without the
 * millisecond of slack below the window reads as opening after the claim and
 * nothing is given back.
 */
export async function release(client: PoolClient, options: {
  enrolmentId: number;
  scope: Scope;
  at: Date;
  problemId?: number;
  difficulty?: Difficulty;
}): Promise<void> {
  const policy = await policyRow(client, options.scope, options.difficulty);
  if (!policy) return;
  await client.query(
    `update rate_limit_counter set count = count - 1
      where id = (select id from rate_limit_counter
                   where enrolment_id = $1 and scope = $2::limit_scope
                     and problem_id is not distinct from $3
                     and window_start <= $4::timestamptz + interval '1 millisecond'
                     and window_start > $4::timestamptz - make_interval(secs => $5)
                     and window_start > now() - make_interval(secs => $5)
                     and count > 0
                   order by window_start desc limit 1)`,
    [options.enrolmentId, options.scope,
     problemScoped(options.scope) ? (options.problemId ?? null) : null, options.at,
     policy.window_s]);
}

/**
 * Which allowance a voice session spends. docs/07 section 10: guided and
 * unguided have a daily cap each, and pressure shares the rehearsal
 * allowance, because it is the expensive mode in both tokens and nerves.
 */
export function voiceScope(mode: "guided" | "unguided" | "pressure"): Scope {
  if (mode === "pressure") return "rehearsal_weekly";
  return mode === "guided" ? "voice_guided_daily" : "voice_unguided_daily";
}

/**
 * Whether a voice answer counts against its allowance.
 *
 * docs/07 section 12 item 9 says a session abandoned mid-answer does not
 * consume the daily allowance, and the only abandonment the server can verify
 * is one that ended early. So an answer counts once it has run thirty seconds
 * or said forty words, whichever comes first. Thirty seconds is the first
 * beat's budget in the worked example, and forty words is about fifteen
 * seconds of speech, enough to have made a claim. Both are this build's own
 * numbers. The duration is measured on the server, so a browser claiming an
 * early end still pays after thirty seconds.
 */
export const VOICE_COUNTS_AFTER = { ms: 30_000, words: 40 };

export function voiceAnswerCounts(answer: { durationMs: number; words: number }): boolean {
  return answer.durationMs >= VOICE_COUNTS_AFTER.ms || answer.words >= VOICE_COUNTS_AFTER.words;
}

/**
 * How many answers that did not count each mode gives back in a rolling day.
 *
 * Each one is up to thirty seconds of metered speech to text that costs the
 * learner nothing, so without a bound a start-and-stop loop is unlimited
 * transcription. Six matches the daily cap on guided and unguided answers, so
 * a learner who abandons a start every time still has their allowance, and
 * the seventh short answer counts and is scored like any other. This build's
 * own number.
 */
export const VOICE_FREE_SHORT_ANSWERS_PER_DAY = 6;

/**
 * docs/03 section 8: an error verdict never consumes an allowance. A learner
 * who loses their one daily Extreme attempt to infrastructure stops trusting
 * every score.
 *
 * The unit goes back to the window the claim went into, which is the latest
 * window for the learner, scope and problem that opened at or before the
 * submission was queued, and to no other. A window already at zero gives
 * nothing back rather than taking the unit off an earlier day. It used to come
 * off every window for the learner and the problem, so one error rewrote the
 * count of every earlier day.
 */
export async function refund(client: PoolClient, submissionId: number): Promise<void> {
  await client.query(
    `update rate_limit_counter set count = count - 1
      where count > 0
        and id = (
        select c.id
          from submission s
          join attempt a on a.id = s.attempt_id
          join problem_version v on v.id = s.problem_version_id
          join rate_limit_counter c
            on c.enrolment_id = a.enrolment_id
           and c.scope = (case s.kind
                 when 'run' then 'run_hourly'
                 when 'submit' then 'submit_daily'
                 when 'live' then 'live_daily'
                 when 'defence' then 'defence_daily'
                 else 'rehearsal_weekly' end)::limit_scope
           and c.problem_id is not distinct from (
                 case when s.kind in ('run','submit') then v.problem_id else null end)
         where s.id = $1
           and c.window_start <= s.queued_at
         order by c.window_start desc
         limit 1)`,
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
    case "defence_daily":
      return `You have used all ${max} defence attempts today. More in ${when}.`;
    case "voice_guided_daily":
      return `You have used all ${max} guided voice answers today. More in ${when}.`;
    case "voice_unguided_daily":
      return `You have used all ${max} unguided voice answers today. More in ${when}.`;
  }
}

export function humanise(seconds: number): string {
  if (seconds <= 60) return "under a minute";
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? "an hour" : `${hours} hours`;
}
