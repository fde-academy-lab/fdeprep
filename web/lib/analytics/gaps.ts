/**
 * Competency gaps: which topic a cohort failed. docs/11 section 4, and story
 * S15.5's acceptance line, faculty seeing it without writing SQL.
 *
 * One competency per row: how many of the cohort's active learners have
 * attempted it, how many of those have passed it, and the mean best state they
 * reached. Lowest pass rate first, so the first row is what the next session
 * has to cover.
 *
 * Every number is a count over competency_score, which eval/ writes. A
 * learner's best state on a competency is the highest of their cells across
 * the tiers, in the one-way order of docs/02 section 7. Nothing here decides
 * a state; it counts the states eval/ decided.
 */
import type { Pool, PoolClient } from "pg";
import { db } from "../db/pool.ts";

export interface GapRow {
  slug: string;
  name: string;
  /** Active learners with at least one cell on this competency. */
  attempted: number;
  /** Of those, the learners whose best cell is passed or clean. */
  passed: number;
  /** attempted over the cohort's active learners, 0 to 1. */
  attemptRate: number;
  /** passed over attempted, 0 to 1; null when nobody has attempted it. */
  passRate: number | null;
  /**
   * The mean of each attempting learner's best state, on the order of docs/02
   * section 7 counted from attempted: 1 attempted, 2 passed, 3 clean. Null
   * when nobody has attempted it.
   */
  meanBest: number | null;
}

export interface Gaps {
  /** Active learners in the cohort, the attempt rate's denominator. */
  learners: number;
  rows: GapRow[];
}

export async function competencyGaps(
  cohortId: number, client: Pool | PoolClient = db(),
): Promise<Gaps> {
  const { rows } = await client.query<{
    slug: string; name: string; attempted: number; passed: number;
    mean_best: string | null; learners: number;
  }>(
    `with learners as (
       select id from enrolment
        where cohort_id = $1 and role = 'learner' and state = 'active'
     ),
     best as (
       select cs.enrolment_id, cs.competency_id,
              max(case cs.state when 'clean' then 3 when 'passed' then 2
                                when 'attempted' then 1 else 0 end) as rank
         from competency_score cs join learners l on l.id = cs.enrolment_id
        group by cs.enrolment_id, cs.competency_id
     )
     select c.slug, c.name,
            count(b.enrolment_id) filter (where b.rank >= 1)::int as attempted,
            count(b.enrolment_id) filter (where b.rank >= 2)::int as passed,
            avg(b.rank) filter (where b.rank >= 1) as mean_best,
            (select count(*) from learners)::int as learners
       from competency c
       left join best b on b.competency_id = c.id
      group by c.id, c.slug, c.name`, [cohortId]);

  const learners = rows[0]?.learners ?? (await client.query<{ n: number }>(
    `select count(*)::int as n from enrolment
      where cohort_id = $1 and role = 'learner' and state = 'active'`, [cohortId])).rows[0]!.n;

  const gaps: GapRow[] = rows.map((row) => ({
    slug: row.slug,
    name: row.name,
    attempted: row.attempted,
    passed: row.passed,
    attemptRate: learners === 0 ? 0 : row.attempted / learners,
    passRate: row.attempted === 0 ? null : row.passed / row.attempted,
    meanBest: row.mean_best === null ? null : Number(row.mean_best),
  }));

  return { learners, rows: gaps.sort(byGap) };
}

/**
 * Lowest pass rate first, then the competency more learners attempted, since
 * a gap across more of the cohort is a bigger one. A competency nobody has
 * attempted goes last: it is unstarted rather than failed.
 */
function byGap(a: GapRow, b: GapRow): number {
  if (a.passRate === null || b.passRate === null) {
    if (a.passRate !== b.passRate) return a.passRate === null ? 1 : -1;
  } else if (a.passRate !== b.passRate) {
    return a.passRate - b.passRate;
  }
  return b.attempted - a.attempted || a.slug.localeCompare(b.slug);
}
