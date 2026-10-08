/**
 * The stuck list. docs/11 section 4 and acceptance 5.
 *
 * One learner and problem pair per row, where three or more failed submits
 * have no pass. A learner failing the same problem four times is a learner
 * about to quit, and this is where faculty decide whom to see in office hours.
 *
 * "Stuck" means this and nothing else on every screen. A submission waiting
 * in the queue with no verdict is "waiting", on Ops. The Overview's Stuck
 * column counts these rows per learner, from the same condition, so the two
 * cannot disagree.
 *
 * A reader: analytics/ writes no grade (docs/11 section 8).
 */
import type { Pool, PoolClient } from "pg";
import { db } from "../db/pool.ts";
import type { Difficulty } from "../policy/tiers.ts";

/**
 * docs/11 section 4: three or more failed submits with no pass. A pass at any
 * point clears the pair, which is acceptance 5. A run is practice and does
 * not count, and neither does an error or a timeout, which are the
 * platform's.
 */
export const STUCK_AT_FAILED_SUBMITS = 3;

const FAILED_SUBMITS = `(select count(*) from submission s
   where s.attempt_id = a.id and s.kind = 'submit' and s.verdict = 'fail')`;

/** A stuck attempt. Expects the attempt aliased `a`. */
export const stuckAttemptSql =
  `(a.solved_at is null and ${FAILED_SUBMITS} >= ${STUCK_AT_FAILED_SUBMITS})`;

export interface StuckRow {
  enrolmentId: number;
  login: string;
  displayName: string;
  /** The enrolment's state, so a paused or ended learner is named as one. */
  state: "active" | "paused" | "ended";
  problemId: number;
  slug: string;
  title: string;
  difficulty: Difficulty;
  failedSubmits: number;
  lastFailedAt: string;
  hintsUsed: number;
  /** What the learner wrote before unlocking hints, which faculty can read. */
  note: string | null;
}

/**
 * Every learner in the cohort, as the Overview lists them. The most recent
 * failure comes first, because the learner still trying is the one an office
 * hour can reach.
 */
export async function stuckList(
  cohortId: number, client: Pool | PoolClient = db(),
): Promise<StuckRow[]> {
  const { rows } = await client.query<{
    enrolment_id: string; login: string; display_name: string; state: StuckRow["state"];
    problem_id: string; slug: string; title: string; difficulty: Difficulty;
    failed: number; last_failed_at: Date; hints_used: number; attempt_note: string | null;
  }>(
    `select e.id as enrolment_id, u.github_login as login, u.display_name,
            e.state::text as state, p.id as problem_id, p.slug, p.title,
            p.difficulty::text as difficulty, ${FAILED_SUBMITS}::int as failed,
            (select max(coalesce(s.finished_at, s.queued_at)) from submission s
              where s.attempt_id = a.id and s.kind = 'submit' and s.verdict = 'fail')
              as last_failed_at,
            a.hints_used, a.attempt_note
       from attempt a
       join enrolment e on e.id = a.enrolment_id
       join app_user u on u.id = e.user_id
       join problem p on p.id = a.problem_id
      where e.cohort_id = $1 and e.role = 'learner' and ${stuckAttemptSql}
      order by last_failed_at desc, failed desc, u.github_login, p.slug`, [cohortId]);

  return rows.map((row) => ({
    enrolmentId: Number(row.enrolment_id),
    login: row.login,
    displayName: row.display_name,
    state: row.state,
    problemId: Number(row.problem_id),
    slug: row.slug,
    title: row.title,
    difficulty: row.difficulty,
    failedSubmits: row.failed,
    lastFailedAt: row.last_failed_at.toISOString(),
    hintsUsed: row.hints_used,
    note: row.attempt_note,
  }));
}
