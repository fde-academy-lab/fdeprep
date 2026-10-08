/**
 * The cohort Overview at /admin: one row per learner with readiness and its
 * four counts, last activity including voice, and the stuck count, with the
 * four numbers over it. docs/11 section 4's cohort standing and stuck list,
 * which faculty read to decide who needs a conversation this week.
 *
 * A reader, like the rest of analytics (docs/11 section 8): readiness comes
 * from readinessForMany, the statement Home and Progress read through
 * readinessFor, and last activity from the fragment Roster reads, so the three
 * screens cannot disagree about a learner (docs/12 section 6). The Active and
 * Stuck numbers are summed from the rows, so they cannot disagree with the
 * table under them either.
 */
import type { Pool, PoolClient } from "pg";
import { db } from "../db/pool.ts";
import { stuckAttemptSql } from "../analytics/stuck.ts";
import { disagreementQueue } from "../eval/review.ts";
import { readinessForMany, type Readiness } from "../progress/readiness.ts";
import type { Persona } from "../policy/roadmap.ts";
import { lastActivitySql } from "./activity.ts";

/**
 * How many rows this learner has on the stuck list (docs/11 section 4): the
 * same condition lib/analytics/stuck.ts lists them by, counted per learner.
 * Expects the enrolment aliased `e`.
 */
const stuckSql = `(select count(*) from attempt a
   where a.enrolment_id = e.id and ${stuckAttemptSql})::int`;

export type EnrolmentState = "active" | "paused" | "ended";

export interface OverviewRow {
  enrolmentId: number;
  login: string;
  displayName: string;
  persona: Persona;
  state: EnrolmentState;
  /** The highest storyline day among passed problems, or null before the first pass. */
  dayReached: number | null;
  lastActivity: string | null;
  /** Last activity inside the past seven days. */
  activeThisWeek: boolean;
  stuck: number;
  /** Null for a paused or ended enrolment, which the Overview shows without one. */
  readiness: Readiness | null;
}

export interface Overview {
  activeThisWeek: number;
  submissionsThisWeek: number;
  stuck: number;
  disagreementsOpen: number;
  /** Newest activity first. */
  rows: OverviewRow[];
}

export async function overview(
  cohortId: number, client: Pool | PoolClient = db(),
): Promise<Overview> {
  const { rows } = await client.query<{
    enrolment_id: string; login: string; display_name: string; persona: Persona;
    state: EnrolmentState; day_reached: number | null; last_activity: Date | null;
    active_week: boolean | null; stuck: number;
  }>(
    `select r.*, r.last_activity > now() - interval '7 days' as active_week
       from (select e.id as enrolment_id, u.github_login as login, u.display_name,
                    e.persona::text as persona, e.state::text as state,
                    (select max(p.day) from attempt a join problem p on p.id = a.problem_id
                      where a.enrolment_id = e.id and a.solved_at is not null) as day_reached,
                    ${lastActivitySql} as last_activity,
                    ${stuckSql} as stuck
               from enrolment e join app_user u on u.id = e.user_id
              where e.cohort_id = $1 and e.role = 'learner') r`, [cohortId]);

  const { rows: week } = await client.query<{ count: string }>(
    `select count(*) from submission s
       join attempt a on a.id = s.attempt_id
       join enrolment e on e.id = a.enrolment_id
      where e.cohort_id = $1 and e.role = 'learner'
        and s.queued_at > now() - interval '7 days'`, [cohortId]);

  const readiness = await readinessForMany(rows.map((row) => Number(row.enrolment_id)), client);
  const queue = await disagreementQueue({ disposition: "open", limit: 1 }, client);

  const learners: OverviewRow[] = rows.map((row) => ({
    enrolmentId: Number(row.enrolment_id),
    login: row.login,
    displayName: row.display_name,
    persona: row.persona,
    state: row.state,
    dayReached: row.day_reached,
    lastActivity: row.last_activity ? row.last_activity.toISOString() : null,
    activeThisWeek: row.active_week === true,
    stuck: row.stuck,
    readiness: row.state === "active" ? readiness.get(Number(row.enrolment_id)) ?? null : null,
  }));

  return {
    activeThisWeek: learners.filter((row) => row.activeThisWeek).length,
    submissionsThisWeek: Number(week[0]!.count),
    stuck: learners.reduce((sum, row) => sum + row.stuck, 0),
    disagreementsOpen: queue.open,
    rows: sortRows(learners, "activity", "desc"),
  };
}

export type OverviewSort = "activity" | "readiness" | "stuck";
export type SortDirection = "asc" | "desc";

/**
 * The table's order. A learner with no activity is the oldest, and one with no
 * readiness (paused or ended) goes last whichever way readiness is sorted.
 * Ties fall back to the login, so the order never shuffles between loads.
 */
export function sortRows(
  rows: readonly OverviewRow[], sort: OverviewSort, direction: SortDirection,
): OverviewRow[] {
  const sign = direction === "asc" ? 1 : -1;
  const key = (row: OverviewRow): number | null =>
    sort === "activity" ? (row.lastActivity ? Date.parse(row.lastActivity) : -Infinity)
      : sort === "readiness" ? row.readiness?.percent ?? null
      : row.stuck;
  return [...rows].sort((a, b) => {
    const [x, y] = [key(a), key(b)];
    if (x === null || y === null) {
      if (x !== y) return x === null ? 1 : -1;
    } else if (x !== y) {
      return x < y ? -sign : sign;
    }
    return a.login.localeCompare(b.login);
  });
}

/* ------------------------------------------------------- one learner's page */

export interface LearnerFacts {
  enrolmentId: number;
  login: string;
  displayName: string;
  persona: Persona;
  state: EnrolmentState;
  cohortName: string;
}

/**
 * A learner in this cohort, or null. The cohort is the viewer's, so a staff
 * member of one cohort cannot open another cohort's learner by changing the
 * number in the address.
 */
export async function learnerFacts(
  enrolmentId: number, cohortId: number, client: Pool | PoolClient = db(),
): Promise<LearnerFacts | null> {
  const { rows } = await client.query<{
    login: string; display_name: string; persona: Persona; state: EnrolmentState; cohort: string;
  }>(
    `select u.github_login as login, u.display_name, e.persona::text as persona,
            e.state::text as state, c.name as cohort
       from enrolment e
       join app_user u on u.id = e.user_id
       join cohort c on c.id = e.cohort_id
      where e.id = $1 and e.cohort_id = $2 and e.role = 'learner'`, [enrolmentId, cohortId]);
  const row = rows[0];
  return row ? {
    enrolmentId, login: row.login, displayName: row.display_name, persona: row.persona,
    state: row.state, cohortName: row.cohort,
  } : null;
}

/** Each attempted problem's newest submission with a trace, by problem id. */
export async function latestTraces(
  enrolmentId: number, client: Pool | PoolClient = db(),
): Promise<Map<number, number>> {
  const { rows } = await client.query<{ problem_id: string; submission_id: string }>(
    `select distinct on (a.problem_id) a.problem_id, s.id as submission_id
       from attempt a
       join submission s on s.attempt_id = a.id
       join trace t on t.submission_id = s.id
      where a.enrolment_id = $1
      order by a.problem_id, s.queued_at desc, s.id desc`, [enrolmentId]);
  return new Map(rows.map((row) => [Number(row.problem_id), Number(row.submission_id)]));
}
