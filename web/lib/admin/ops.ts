/**
 * The ops dashboard, S10's fourth screen.
 *
 * docs/02 section 9: the ops dashboard reads runner_event for the last hour and
 * nothing older. docs/05 section 7 says what an operator does with these
 * numbers, and the stuck list is the one that starts the runbook: "a row
 * sitting in queued for over five minutes with an empty queue means the message
 * was lost".
 */
import type { Pool, PoolClient } from "pg";
import { db } from "../db/pool.ts";
import { readDegradedMode, type DegradedMode } from "../policy/settings.ts";

/** docs/05 section 7, step 2 of the stuck-submission runbook. */
export const STUCK_AFTER_MINUTES = 5;
/** docs/05 section 6: the queue alarm fires above this, so the screen marks it. */
export const QUEUE_DEPTH_ALARM = 50;

export interface StuckRow {
  id: number;
  login: string;
  slug: string;
  queuedAt: string;
  waitingMinutes: number;
}

export interface OpsSnapshot {
  queueDepth: number;
  resultsDepth: number;
  judgeDepth: number;
  queueBackingUp: boolean;
  /** Fraction of the last hour's runner events that were errors, 0 to 1. */
  errorRate: number;
  errorCount: number;
  eventCount: number;
  /** Live-run model calls today, which is what the token-spend alarm tracks. */
  liveCallsToday: number;
  stuck: StuckRow[];
  degraded: DegradedMode;
}

export async function opsSnapshot(client: Pool | PoolClient = db()): Promise<OpsSnapshot> {
  const depths = await client.query<{ queue: string; count: string }>(
    `select queue, count(*) from queue_message
      where deleted_at is null group by queue`);
  const depthOf = (name: string) =>
    Number(depths.rows.find((row) => row.queue === name)?.count ?? 0);

  const { rows: events } = await client.query<{ total: string; errors: string }>(
    `select count(*) as total,
            count(*) filter (where level = 'error') as errors
       from runner_event where created_at > now() - interval '1 hour'`);
  const total = Number(events[0]?.total ?? 0);
  const errors = Number(events[0]?.errors ?? 0);

  const { rows: live } = await client.query<{ calls: string }>(
    `select coalesce(sum(s.llm_calls), 0) as calls from submission s
      where s.kind = 'live' and s.queued_at > date_trunc('day', now())`);

  const { rows: stuck } = await client.query<{
    id: string; login: string; slug: string; queued_at: Date; waiting: string;
  }>(
    `select s.id, u.github_login as login, p.slug, s.queued_at,
            extract(epoch from (now() - s.queued_at)) / 60 as waiting
       from submission s
       join attempt a on a.id = s.attempt_id
       join enrolment e on e.id = a.enrolment_id
       join app_user u on u.id = e.user_id
       join problem_version v on v.id = s.problem_version_id
       join problem p on p.id = v.problem_id
      where s.verdict is null
        and s.queued_at < now() - make_interval(mins => $1)
      order by s.queued_at`, [STUCK_AFTER_MINUTES]);

  const queueDepth = depthOf("submissions");

  return {
    queueDepth,
    resultsDepth: depthOf("results"),
    judgeDepth: depthOf("judgements"),
    queueBackingUp: queueDepth > QUEUE_DEPTH_ALARM,
    errorRate: total === 0 ? 0 : errors / total,
    errorCount: errors,
    eventCount: total,
    liveCallsToday: Number(live[0]?.calls ?? 0),
    stuck: stuck.map((row) => ({
      id: Number(row.id),
      login: row.login,
      slug: row.slug,
      queuedAt: row.queued_at.toISOString(),
      waitingMinutes: Math.round(Number(row.waiting)),
    })),
    degraded: await readDegradedMode(client),
  };
}
