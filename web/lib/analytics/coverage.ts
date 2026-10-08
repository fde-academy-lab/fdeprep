/**
 * Interview coverage across a cohort. docs/11 section 4 and docs/10 section 12.
 *
 * One round per row: how many published problems count toward it, how many of
 * those the cohort's active learners have practised, and how many of those
 * learners have practised at least one. It answers whether the catalogue has
 * drifted away from what interviews ask.
 *
 * The round rule and the meaning of practised are the ones the readiness
 * line's coverage reads (lib/progress/coverage.ts), imported rather than
 * written again, so a learner's own count and the cohort's cannot disagree
 * about what counts.
 */
import type { Pool, PoolClient } from "pg";
import { db } from "../db/pool.ts";
import { countsTowardSql, PRACTISED_SQL, ROUNDS, type Round } from "../progress/coverage.ts";

export interface CoverageRow {
  round: Round;
  /** Published problems that count toward this round. */
  catalogue: number;
  /** Of those, the problems at least one active learner has practised. */
  practised: number;
  /** Active learners who have practised at least one of them. */
  learners: number;
}

export interface CohortCoverage {
  rows: CoverageRow[];
  /** Published problems whose current version declares no round yet. */
  undeclared: number;
}

export async function interviewCoverage(
  cohortId: number, client: Pool | PoolClient = db(),
): Promise<CohortCoverage> {
  const rows: CoverageRow[] = [];
  for (const round of ROUNDS) {
    const { rows: [row] } = await client.query<{
      catalogue: number; practised: number; learners: number;
    }>(
      `with catalogue as (
         select p.id from problem p
           join problem_version v on v.problem_id = p.id and v.version = p.current_version
          where p.is_published and ${countsTowardSql(round)}
       ),
       practised as (
         select distinct a.problem_id, a.enrolment_id
           from attempt a
           join enrolment e on e.id = a.enrolment_id
          where e.cohort_id = $1 and e.role = 'learner' and e.state = 'active'
            and a.problem_id in (select id from catalogue) and ${PRACTISED_SQL}
       )
       select (select count(*) from catalogue)::int as catalogue,
              (select count(distinct problem_id) from practised)::int as practised,
              (select count(distinct enrolment_id) from practised)::int as learners`,
      [cohortId]);
    rows.push({ round, ...row! });
  }

  const { rows: [undeclared] } = await client.query<{ n: number }>(
    `select count(*)::int as n from problem p
       join problem_version v on v.problem_id = p.id and v.version = p.current_version
      where p.is_published and (v.interview ->> 'round') is null`);

  return { rows, undeclared: undeclared!.n };
}
