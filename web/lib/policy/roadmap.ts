/**
 * The persona roadmaps, from docs/00 section 3.2's persona table.
 *
 * This lives inside lib/policy because ordering a roadmap means ranking by
 * difficulty, and CLAUDE.md puts every difficulty decision in one module. A
 * component asks for a roadmap; it never works out which tier comes first.
 *
 * The persona changes order and nothing else. docs/00: "The persona changes the
 * ordered roadmap and the default landing view. It never hides a problem."
 * Reachability lives in the catalogue, which reads from `problem` and never
 * from `track_item`.
 */
import type { Pool, PoolClient } from "pg";
import { db } from "../db/pool.ts";
import { DIFFICULTIES, type Difficulty } from "./tiers.ts";

export type Persona = "builder" | "navigator" | "accelerator";
export const PERSONAS: readonly Persona[] = ["builder", "navigator", "accelerator"];

/**
 * docs/00 names "the fundamentals track" without saying which of the six track
 * slugs it is. The agent loop is the thing every other track builds on, so it
 * is the one read as fundamentals here.
 */
export const FUNDAMENTALS = "agent-loop";

interface PersonaShape {
  name: string;
  /** Tiers in roadmap order. Anything absent is optional revision. */
  ladder: readonly Difficulty[];
  /** Tracks that sort first within a tier. */
  emphasis: readonly string[];
  /**
   * Fraction of the required items that must be solved before the optional
   * ones join the roadmap. docs/00 states this only for Builder, at 60 percent
   * of the track; the other two personas treat their optional items as
   * revision and surface them once the required runway is done.
   */
  unlockOptionalAt: number;
}

export const SHAPES: Readonly<Record<Persona, PersonaShape>> = {
  // "Starts on the Easy tier of the fundamentals track, long runway of guided
  // problems, Extreme problems visible but not on the roadmap until the track
  // is 60 percent complete."
  builder: {
    name: "Foundations for FDEs",
    ladder: ["easy", "medium", "hard"],
    emphasis: [FUNDAMENTALS],
    unlockOptionalAt: 0.6,
  },
  // "Starts at Medium on fundamentals, roadmap weights toward tool creation,
  // memory and retrieval."
  navigator: {
    name: "Agentic AI for FDEs",
    ladder: ["medium", "hard", "extreme"],
    emphasis: [FUNDAMENTALS, "tool-creation", "memory", "rag"],
    unlockOptionalAt: 1,
  },
  // "Starts at Hard, roadmap is mostly Extreme and design-argument problems,
  // fundamentals available as optional revision."
  accelerator: {
    name: "Screen-ready for FDEs",
    ladder: ["hard", "extreme"],
    emphasis: ["evals", "prompt", FUNDAMENTALS],
    unlockOptionalAt: 1,
  },
};

export interface RoadmapItem {
  problemId: number;
  slug: string;
  title: string;
  difficulty: Difficulty;
  track: string;
  artefactType: string;
  estMinutes: number;
  competencyCount: number;
  ordinal: number;
  isOptional: boolean;
  solved: boolean;
  attempted: boolean;
}

export interface Roadmap {
  persona: Persona;
  trackName: string;
  items: RoadmapItem[];
  solved: number;
  total: number;
  /** True once the persona's optional items have joined the roadmap. */
  optionalUnlocked: boolean;
}

interface SeedRow {
  id: number;
  slug: string;
  difficulty: Difficulty;
  track: string;
  artefact_type: string;
}

/**
 * Where a problem sits for one persona.
 *
 * A tier on the persona's ladder sorts by its position there. A tier off the
 * ladder is revision: it sorts after everything required and is marked
 * optional. Every problem lands somewhere for every persona, which is what
 * makes the roadmaps cover the catalogue rather than a corner of it.
 */
export function rank(
  persona: Persona, row: { difficulty: Difficulty; track: string; artefact_type: string },
): { order: [number, number, number]; isOptional: boolean } {
  const shape = SHAPES[persona];
  const onLadder = shape.ladder.indexOf(row.difficulty);
  const isOptional = onLadder === -1;

  // Off-ladder tiers keep their natural order behind the required ones.
  const tier = isOptional
    ? shape.ladder.length + DIFFICULTIES.indexOf(row.difficulty)
    : onLadder;

  const emphasis = shape.emphasis.indexOf(row.track);
  const trackRank = emphasis === -1 ? shape.emphasis.length : emphasis;

  // The accelerator's roadmap is "mostly Extreme and design-argument
  // problems", so a design artefact sorts ahead of code within its tier.
  const artefactRank = persona === "accelerator" && row.artefact_type === "design" ? 0 : 1;

  return { order: [tier, trackRank, artefactRank], isOptional };
}

/** Deterministic order for one persona over the whole catalogue. */
export function orderFor(persona: Persona, rows: SeedRow[]): Array<SeedRow & { isOptional: boolean }> {
  return rows
    .map((row) => ({ row, ...rank(persona, row) }))
    .sort((a, b) =>
      a.order[0] - b.order[0] ||
      a.order[1] - b.order[1] ||
      a.order[2] - b.order[2] ||
      // Slug last, so the order is total and the same on every run.
      a.row.slug.localeCompare(b.row.slug))
    .map(({ row, isOptional }) => ({ ...row, isOptional }));
}

/**
 * Rebuild one track per persona over the current catalogue.
 *
 * Idempotent, because the catalogue grows: an import adds problems and the
 * roadmaps have to take them without anyone remembering to re-seed by hand.
 */
export async function seedTracks(client: Pool | PoolClient = db()): Promise<number> {
  const { rows } = await client.query<SeedRow>(
    `select id, slug, difficulty::text as difficulty, track,
            artefact_type::text as artefact_type
       from problem order by slug`);
  if (!rows.length) return 0;

  let written = 0;
  for (const persona of PERSONAS) {
    const shape = SHAPES[persona];
    const { rows: trackRows } = await client.query<{ id: string }>(
      `insert into track (slug, name, persona) values ($1, $2, $3::persona)
       on conflict (slug) do update set name = excluded.name
       returning id`,
      [`roadmap-${persona}`, shape.name, persona]);
    const trackId = Number(trackRows[0]!.id);

    await client.query("delete from track_item where track_id = $1", [trackId]);
    for (const [index, item] of orderFor(persona, rows.map(normalise)).entries()) {
      await client.query(
        `insert into track_item (track_id, problem_id, ordinal, is_optional)
         values ($1, $2, $3, $4)`,
        [trackId, item.id, index + 1, item.isOptional]);
      written += 1;
    }
  }
  return written;
}

function normalise(row: SeedRow): SeedRow {
  return { ...row, id: Number(row.id) };
}

export async function roadmapFor(
  enrolmentId: number, client: Pool | PoolClient = db(),
): Promise<Roadmap> {
  const { rows: personaRows } = await client.query<{ persona: Persona }>(
    "select persona::text as persona from enrolment where id = $1", [enrolmentId]);
  const persona = personaRows[0]?.persona;
  if (!persona) throw new Error(`enrolment ${enrolmentId} not found`);

  const { rows } = await client.query<{
    problem_id: string; slug: string; title: string; difficulty: Difficulty;
    track: string; artefact_type: string; est_minutes: number; ordinal: number;
    is_optional: boolean; solved: boolean; attempted: boolean; competency_count: number;
  }>(
    `select p.id as problem_id, p.slug, p.title, p.difficulty::text as difficulty,
            p.track, p.artefact_type::text as artefact_type, p.est_minutes,
            i.ordinal, i.is_optional,
            a.solved_at is not null as solved,
            a.id is not null as attempted,
            (select count(*) from problem_competency pc
              where pc.problem_id = p.id)::int as competency_count
       from track_item i
       join track t on t.id = i.track_id
       join problem p on p.id = i.problem_id
       left join attempt a on a.problem_id = p.id and a.enrolment_id = $1
      where t.persona = $2::persona
      order by i.ordinal`,
    [enrolmentId, persona]);

  const items: RoadmapItem[] = rows.map((row) => ({
    problemId: Number(row.problem_id),
    slug: row.slug,
    title: row.title,
    difficulty: row.difficulty,
    track: row.track,
    artefactType: row.artefact_type,
    estMinutes: row.est_minutes,
    competencyCount: row.competency_count,
    ordinal: row.ordinal,
    isOptional: row.is_optional,
    solved: row.solved,
    attempted: row.attempted,
  }));

  const required = items.filter((item) => !item.isOptional);
  const requiredSolved = required.filter((item) => item.solved).length;
  const threshold = SHAPES[persona].unlockOptionalAt;

  return {
    persona,
    trackName: SHAPES[persona].name,
    items,
    solved: items.filter((item) => item.solved).length,
    total: items.length,
    optionalUnlocked:
      required.length === 0 || requiredSolved >= Math.ceil(required.length * threshold),
  };
}

export interface NextUp {
  /** `start` before the first attempt, `done` when nothing is left. */
  kind: "start" | "next_up" | "done";
  items: RoadmapItem[];
  roadmap: Roadmap;
}

const CARDS = 3;

/**
 * docs/01 S2: three cards, drawn from the persona roadmap, skipping solved
 * problems. A learner with zero attempts sees a start card instead, pointing at
 * the first roadmap item.
 */
export async function nextUp(
  enrolmentId: number, client: Pool | PoolClient = db(),
): Promise<NextUp> {
  const roadmap = await roadmapFor(enrolmentId, client);
  const unsolved = roadmap.items.filter((item) => !item.solved);

  const pool = roadmap.optionalUnlocked
    ? [...unsolved.filter((i) => !i.isOptional), ...unsolved.filter((i) => i.isOptional)]
    : unsolved.filter((item) => !item.isOptional);

  if (!pool.length) return { kind: "done", items: [], roadmap };
  if (!roadmap.items.some((item) => item.attempted)) {
    return { kind: "start", items: pool.slice(0, 1), roadmap };
  }
  return { kind: "next_up", items: pool.slice(0, CARDS), roadmap };
}
