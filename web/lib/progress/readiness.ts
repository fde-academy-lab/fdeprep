/**
 * The readiness signal. docs/12 section 2.
 *
 *   readiness = clean cells / cells the learner's track requires
 *
 * progress/ reading what eval/ wrote. One statement over competency_score and
 * the persona track; no grade, band or cell state is computed here. A page
 * showing one learner and a page showing a cohort get the number from the same
 * statement, because readinessFor asks readinessForMany for one enrolment, so
 * the two cannot drift (docs/12 section 6).
 *
 * The cells a track requires, as this repository can compute them: the
 * distinct (competency, difficulty) pairs over the published problems on the
 * learner's persona track that the track does not mark optional. A tier off a
 * persona's ladder is optional (lib/policy/roadmap.ts), so a navigator is not
 * held to Easy, and a clean Easy cell neither counts for a navigator nor sits
 * in their denominator. That is one reading of "the cells the learner's track
 * requires"; if docs/12 means the whole catalogue, this is the line to change.
 */
import type { Pool, PoolClient } from "pg";
import { db } from "../db/pool.ts";
import { SCREEN_EVIDENCE } from "../policy/tiers.ts";

export type ReadinessBand = "not_ready" | "developing" | "screen_ready";

export interface Readiness {
  /** 0 to 100, floored. */
  percent: number;
  band: ReadinessBand;
  clean: number;
  passed: number;
  attempted: number;
  untouched: number;
  /** Cells the learner's track requires. */
  required: number;
}

/** docs/12 section 2: below 40 not_ready, 40 to 69 developing, 70 and above screen_ready. */
const DEVELOPING_AT = 40;
const SCREEN_READY_AT = 70;

/**
 * The band. Seventy percent is screen_ready only with at least one clean
 * required cell at a tier the policy module counts as screen evidence.
 */
export function bandFor(percent: number, screenEvidence: number): ReadinessBand {
  if (percent >= SCREEN_READY_AT && screenEvidence > 0) return "screen_ready";
  if (percent >= DEVELOPING_AT) return "developing";
  return "not_ready";
}

export async function readinessForMany(
  enrolmentIds: readonly number[], client: Pool | PoolClient = db(),
): Promise<Map<number, Readiness>> {
  if (!enrolmentIds.length) return new Map();

  const { rows } = await client.query<{
    enrolment_id: string; required: number; clean: number; passed: number;
    attempted: number; screen_evidence: number;
  }>(
    `with target as (
       select e.id, e.persona from enrolment e where e.id = any($1::bigint[])
     ),
     required as (
       select distinct target.id as enrolment_id, pc.competency_id, p.difficulty
         from target
         join track t on t.persona = target.persona
         join track_item i on i.track_id = t.id and not i.is_optional
         join problem p on p.id = i.problem_id and p.is_published
         join problem_competency pc on pc.problem_id = p.id
     )
     select target.id as enrolment_id,
            count(r.competency_id)::int as required,
            count(*) filter (where s.state = 'clean')::int as clean,
            count(*) filter (where s.state = 'passed')::int as passed,
            count(*) filter (where s.state = 'attempted')::int as attempted,
            count(*) filter (where s.state = 'clean'
                               and r.difficulty = any($2::difficulty[]))::int as screen_evidence
       from target
       left join required r on r.enrolment_id = target.id
       left join competency_score s
         on s.enrolment_id = r.enrolment_id and s.competency_id = r.competency_id
        and s.difficulty = r.difficulty
      group by target.id`,
    [enrolmentIds, SCREEN_EVIDENCE]);

  return new Map(rows.map((row) => {
    const percent = row.required === 0 ? 0 : Math.floor((row.clean * 100) / row.required);
    return [Number(row.enrolment_id), {
      percent,
      band: bandFor(percent, row.screen_evidence),
      clean: row.clean,
      passed: row.passed,
      attempted: row.attempted,
      untouched: row.required - row.clean - row.passed - row.attempted,
      required: row.required,
    }];
  }));
}

export async function readinessFor(
  enrolmentId: number, client: Pool | PoolClient = db(),
): Promise<Readiness> {
  const readiness = (await readinessForMany([enrolmentId], client)).get(enrolmentId);
  if (!readiness) throw new Error(`enrolment ${enrolmentId} not found`);
  return readiness;
}
