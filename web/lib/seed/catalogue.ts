/**
 * What the seed plans against: the published problems, each persona's track
 * and the published voice questions. Reads only.
 *
 * The plan is pure and takes this as data, so the same catalogue always plans
 * the same rows, and a test can hand the plan a catalogue without a database.
 */
import type { Pool, PoolClient } from "pg";
import { db } from "../db/pool.ts";
import type { Band } from "../policy/bands.ts";
import { policyRow } from "../policy/caps.ts";
import { PERSONAS, type Persona } from "../policy/roadmap.ts";
import type { Difficulty } from "../policy/tiers.ts";
import type { Catalogue, CatalogueProblem } from "./plan.ts";

export async function loadCatalogue(client: Pool | PoolClient = db()): Promise<Catalogue> {
  const { rows } = await client.query<{
    slug: string; difficulty: Difficulty; artefact_type: CatalogueProblem["artefactType"];
    hints: number; call_budget: number | null; has_defence: boolean;
    build_id: string | null; build_stage: number | null;
  }>(
    `select p.slug, p.difficulty::text as difficulty, p.artefact_type::text as artefact_type,
            (select count(*) from hint h where h.problem_version_id = v.id)::int as hints,
            v.call_budget, v.defence_question is not null as has_defence,
            v.kit->'build'->>'id' as build_id, (v.kit->'build'->>'stage')::int as build_stage
       from problem p
       join problem_version v on v.problem_id = p.id and v.version = p.current_version
      where p.is_published
      order by p.slug`);

  // The cap is a policy row per tier, read through the policy module rather
  // than matched against a tier name here.
  const caps = new Map<Difficulty, number | null>();
  for (const difficulty of new Set(rows.map((row) => row.difficulty))) {
    caps.set(difficulty, (await policyRow(client, "submit_daily", difficulty))?.max_count ?? null);
  }

  const problems: CatalogueProblem[] = rows.map((row) => ({
    slug: row.slug,
    difficulty: row.difficulty,
    artefactType: row.artefact_type,
    hints: row.hints,
    callBudget: row.call_budget,
    submitCap: caps.get(row.difficulty) ?? null,
    hasDefence: row.has_defence,
    build: row.build_id ? { id: row.build_id, stage: row.build_stage ?? 1 } : null,
  }));

  const published = new Set(problems.map((p) => p.slug));
  const { rows: items } = await client.query<{ persona: Persona; slug: string }>(
    `select t.persona::text as persona, p.slug
       from track_item i
       join track t on t.id = i.track_id
       join problem p on p.id = i.problem_id
      order by t.persona, i.ordinal`);
  const paths = Object.fromEntries(PERSONAS.map((persona) => [persona,
    items.filter((i) => i.persona === persona && published.has(i.slug)).map((i) => i.slug)],
  )) as Record<Persona, string[]>;

  const { rows: questions } = await client.query<{
    slug: string; total_seconds: number; beats: number; bands: Band[]; follow_ups: number;
  }>(
    `select q.slug, q.total_seconds,
            (select count(*) from voice_beat b where b.voice_question_id = q.id)::int as beats,
            array(select e.band from voice_exemplar e where e.voice_question_id = q.id
                   order by e.band) as bands,
            (select count(*) from voice_follow_up f
              where f.voice_question_id = q.id and f.retired_at is null)::int as follow_ups
       from voice_question q
      where q.is_published
      order by q.slug`);

  return {
    problems,
    paths,
    questions: questions
      .filter((q) => q.beats > 0 && q.bands.length > 0)
      .map((q) => ({
        slug: q.slug, totalSeconds: q.total_seconds, beats: q.beats,
        bands: q.bands, followUps: q.follow_ups,
      })),
  };
}
