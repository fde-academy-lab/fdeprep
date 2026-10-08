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
import { MAX_JUDGE_ATTEMPTS } from "../voice/score.ts";

/** docs/05 section 7, step 2 of the stuck-submission runbook. */
export const STUCK_AFTER_MINUTES = 5;
/**
 * A finished voice answer with no score after this long means the scorer is
 * not running. `npm run scorevoice` scores answers in the order they finished,
 * a few seconds each, so an hour is far past a backlog.
 */
export const STUCK_VOICE_AFTER_MINUTES = 60;
/** docs/05 section 6: the queue alarm fires above this, so the screen marks it. */
export const QUEUE_DEPTH_ALARM = 50;

export interface StuckRow {
  id: number;
  login: string;
  slug: string;
  queuedAt: string;
  waitingMinutes: number;
}

export interface StuckVoiceRow {
  id: number;
  login: string;
  questionTitle: string;
  finishedAt: string;
  waitingMinutes: number;
  /**
   * scorer_not_running: no attempt yet, and over an hour since the answer
   * finished. judge_gave_up: the judge failed MAX_JUDGE_ATTEMPTS times and
   * the answer's allowance was given back.
   */
  why: "scorer_not_running" | "judge_gave_up";
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
  stuckVoice: StuckVoiceRow[];
  degraded: DegradedMode;
}

/**
 * One day of practice across the platform. A run is `run` or `live`; every
 * other kind is a submit, rehearsal and defence submits included. Passed and
 * Failed count submits, since a run that passes solves nothing, and Errors
 * counts every kind, since an error is the platform's whichever button made it.
 * A voice answer is a session started that day, the moment last activity reads.
 */
export interface DayRow {
  /** YYYY-MM-DD in the database's time zone. */
  date: string;
  runs: number;
  submits: number;
  passed: number;
  failed: number;
  errors: number;
  voiceAnswers: number;
}

/** Today and the six days before it, newest first, with a row for a day with nothing in it. */
export async function sevenDays(client: Pool | PoolClient = db()): Promise<DayRow[]> {
  const { rows } = await client.query<{
    day: string; runs: string; submits: string; passed: string; failed: string; errors: string;
    voice: string;
  }>(
    `with days as (
       select generate_series(current_date - 6, current_date, interval '1 day')::date as day
     )
     select to_char(d.day, 'YYYY-MM-DD') as day,
            count(s.id) filter (where s.kind in ('run', 'live')) as runs,
            count(s.id) filter (where s.kind not in ('run', 'live')) as submits,
            count(s.id) filter (where s.kind not in ('run', 'live') and s.verdict = 'pass') as passed,
            count(s.id) filter (where s.kind not in ('run', 'live') and s.verdict = 'fail') as failed,
            count(s.id) filter (where s.verdict = 'error') as errors,
            (select count(*) from voice_session v
              where v.started_at >= d.day and v.started_at < d.day + 1) as voice
       from days d
       left join submission s on s.queued_at >= d.day and s.queued_at < d.day + 1
      group by d.day
      order by d.day desc`);
  return rows.map((row) => ({
    date: row.day,
    runs: Number(row.runs),
    submits: Number(row.submits),
    passed: Number(row.passed),
    failed: Number(row.failed),
    errors: Number(row.errors),
    voiceAnswers: Number(row.voice),
  }));
}

/** A wait as Ops shows it: "9m" under an hour, "3h 2m" under a day, "2d 0h" after that. */
export function waitingLabel(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`;
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

  const { rows: stuckVoice } = await client.query<{
    id: string; login: string; title: string; finished_at: Date; waiting: string; gave_up: boolean;
  }>(
    `select v.id, u.github_login as login, q.title, v.finished_at,
            extract(epoch from (now() - v.finished_at)) / 60 as waiting,
            v.judge_attempts >= $2 as gave_up
       from voice_session v
       join enrolment e on e.id = v.enrolment_id
       join app_user u on u.id = e.user_id
       join voice_question q on q.id = v.voice_question_id
      where v.finished_at is not null and v.scored_at is null
        and (v.judge_attempts >= $2
             or v.finished_at < now() - make_interval(mins => $1))
      order by v.finished_at`, [STUCK_VOICE_AFTER_MINUTES, MAX_JUDGE_ATTEMPTS]);

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
    stuckVoice: stuckVoice.map((row) => ({
      id: Number(row.id),
      login: row.login,
      questionTitle: row.title,
      finishedAt: row.finished_at.toISOString(),
      waitingMinutes: Math.round(Number(row.waiting)),
      why: row.gave_up ? "judge_gave_up" : "scorer_not_running",
    })),
    degraded: await readDegradedMode(client),
  };
}
