/**
 * Interview coverage: which rounds a learner has practised. docs/12 section 5
 * and acceptance 9.
 *
 * The readiness number says nothing about interview format, so a learner can
 * reach screen_ready on written problems alone. This reads
 * interview_evidence.round from the problems a learner has practised and
 * counts them per round, and the readiness line shows the two counts beside
 * the signal.
 *
 * A problem counts once, no matter how often it was submitted, and a problem
 * marked `both` counts toward written and toward oral. Practised means a
 * submission whose verdict the learner earned, pass or fail: the same evidence
 * that moves a heatmap cell, so an error or a timeout practises nothing.
 *
 * A reader, like the rest of progress/: no table is written here.
 */
import type { Pool, PoolClient } from "pg";
import { db } from "../db/pool.ts";

export type Round = "written" | "oral";
export const ROUNDS: readonly Round[] = ["written", "oral"];

export interface Coverage {
  /** Distinct problems practised, whatever their round. */
  practised: number;
  written: number;
  oral: number;
}

/**
 * Whether a problem version counts toward `round`: its own round, or both.
 * `version` is the alias of problem_version in the calling statement. A
 * version published before migration 020 has no interview yet and counts
 * toward neither.
 */
export function countsTowardSql(round: Round, version = "v"): string {
  return `(${version}.interview ->> 'round') in ('${round}', 'both')`;
}

/** An attempt with a verdict the learner earned. Expects the attempt aliased `a`. */
export const PRACTISED_SQL = `exists (select 1 from submission s
   where s.attempt_id = a.id and s.verdict in ('pass', 'fail'))`;

export async function coverageForMany(
  enrolmentIds: readonly number[], client: Pool | PoolClient = db(),
): Promise<Map<number, Coverage>> {
  if (!enrolmentIds.length) return new Map();
  const { rows } = await client.query<{
    enrolment_id: string; practised: number; written: number; oral: number;
  }>(
    `select e.id as enrolment_id,
            count(distinct a.problem_id)::int as practised,
            count(distinct a.problem_id) filter (where ${countsTowardSql("written")})::int as written,
            count(distinct a.problem_id) filter (where ${countsTowardSql("oral")})::int as oral
       from enrolment e
       left join attempt a on a.enrolment_id = e.id and ${PRACTISED_SQL}
       left join problem p on p.id = a.problem_id
       left join problem_version v on v.problem_id = p.id and v.version = p.current_version
      where e.id = any($1::bigint[])
      group by e.id`, [enrolmentIds]);
  return new Map(rows.map((row) => [Number(row.enrolment_id), {
    practised: row.practised, written: row.written, oral: row.oral,
  }]));
}

export async function coverageFor(
  enrolmentId: number, client: Pool | PoolClient = db(),
): Promise<Coverage> {
  return (await coverageForMany([enrolmentId], client)).get(enrolmentId) ??
    { practised: 0, written: 0, oral: 0 };
}
