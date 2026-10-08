/**
 * The order of an end-to-end build. Added 29 September 2026 with the builds track.
 *
 * Each stage's starter code carries the previous stage's capability as working
 * code, because a build is assembled one stage on the last. So stage N opens
 * only once stage N-1 has passed or been given up (a give-up already opened
 * the walkthrough, so nothing further is revealed). Faculty and admins see
 * every stage, since reviewing a build means reading all of it.
 *
 * Here rather than in a component because it decides what a learner may run
 * and see, which is policy, and because the submission path has to ask the
 * same question the page does.
 */
import type { Pool, PoolClient } from "pg";
import { db } from "../db/pool.ts";

export interface BuildLock {
  reason: string;
  previous: { slug: string; title: string; stage: number };
}

export async function buildLock(
  enrolmentId: number, problemId: number, client: Pool | PoolClient = db(),
): Promise<BuildLock | null> {
  const { rows } = await client.query<{
    slug: string; title: string; stage: number; done: boolean; role: string;
  }>(
    `with me as (
       select v.kit->'build'->>'id' as build_id, (v.kit->'build'->>'stage')::int as stage
         from problem p
         join problem_version v on v.problem_id = p.id and v.version = p.current_version
        where p.id = $1 and v.kit ? 'build'
     )
     select prev.slug, prev.title, me.stage,
            coalesce(a.solved_at is not null or a.gave_up_at is not null, false) as done,
            (select e.role::text from enrolment e where e.id = $2) as role
       from me
       join problem_version pv on pv.kit->'build'->>'id' = me.build_id
                               and (pv.kit->'build'->>'stage')::int = me.stage - 1
       join problem prev on prev.id = pv.problem_id and pv.version = prev.current_version
       left join attempt a on a.problem_id = prev.id and a.enrolment_id = $2
      limit 1`,
    [problemId, enrolmentId]);

  const row = rows[0];
  if (!row || row.done || row.role === "faculty" || row.role === "admin") return null;
  return {
    reason: `Stage ${row.stage} opens once stage ${row.stage - 1}, "${row.title}", passes. ` +
            "Its starter code is built on that stage's work.",
    previous: { slug: row.slug, title: row.title, stage: row.stage - 1 },
  };
}
