/**
 * Screen S3, the problems catalogue.
 *
 * docs/02 section 5: the catalogue reads from `problem`, never from
 * `track_item`, which is what keeps the whole pool open to everyone.
 */
import { db } from "../db/pool.ts";
import { tierFor, type Difficulty } from "../policy/tiers.ts";
import { TRACKS, type Track } from "./vocabulary.ts";

export type SolveState = "solved" | "attempted" | "untouched";
export type Sort = "roadmap" | "storyline" | "difficulty" | "recent" | "least_attempted";

export interface CatalogueFilters {
  search?: string;
  track?: string;
  /** Any of these tracks, which is how a stage filters. */
  tracks?: readonly string[];
  difficulty?: string;
  artefactType?: string;
  status?: SolveState | "all";
  sort?: Sort;
  page?: number;
  perPage?: number;
}

export interface CatalogueRow {
  id: number;
  slug: string;
  title: string;
  /** The day of a learner's first 30 as an FDE, or null before the problem is republished. */
  day: number | null;
  skill: string | null;
  /** The incident the problem starts from, shown under the title. */
  headline: string | null;
  /** The topic inside the chapter, and the question the problem answers. */
  topic: string | null;
  question: string | null;
  difficulty: Difficulty;
  track: string;
  artefactType: string;
  estMinutes: number;
  state: SolveState;
  /** Null when the tier hides it, which the policy module decides, or nobody has tried. */
  solveRate: number | null;
  /** Whether this tier shows a solve rate at all. */
  solveRateShown: boolean;
  attemptCount: number;
  /** Where the learner's path puts this problem, or null when no path carries it. */
  ordinal: number | null;
}

export interface CataloguePage {
  rows: CatalogueRow[];
  total: number;
  page: number;
  perPage: number;
  pages: number;
}

const DIFFICULTY_ORDER = "case p.difficulty when 'easy' then 1 when 'medium' then 2 " +
  "when 'hard' then 3 else 4 end";

const SORTS: Record<Sort, string> = {
  // The learner's own persona roadmap, which lib/policy orders. A problem no
  // roadmap carries yet sorts after all of them rather than disappearing.
  roadmap: `road.ordinal nulls last, ${DIFFICULTY_ORDER}, p.track, p.id`,
  // The 30-day storyline, the same order for every learner.
  storyline: "p.day nulls last, p.id",
  difficulty: `${DIFFICULTY_ORDER}, p.title`,
  recent: "p.created_at desc, p.id desc",
  least_attempted: "coalesce(stats.attempts, 0) asc, p.title",
};

/**
 * The learner's own persona roadmap, joined as `road`. Every path order reads
 * `road.ordinal`, the order lib/policy/roadmap.ts wrote, so Home, Problems,
 * the palette and a chapter page cannot disagree about what comes first.
 */
const ROAD = `
  left join track_item road on road.problem_id = p.id and road.track_id = (
    select t.id from track t join enrolment e on t.slug = 'roadmap-' || e.persona::text
     where e.id = $1)`;

export async function listProblems(
  options: CatalogueFilters & { enrolmentId: number },
): Promise<CataloguePage> {
  const page = Math.max(1, options.page ?? 1);
  const perPage = Math.min(100, Math.max(1, options.perPage ?? 25));
  const sort = SORTS[options.sort ?? "roadmap"] ?? SORTS.roadmap;

  const where: string[] = [];
  const params: unknown[] = [options.enrolmentId];
  const add = (clause: string, value: unknown) => {
    params.push(value);
    // Every $$ names the same value. split and join number each one, where
    // replace would number the first and leave the rest for Postgres to read
    // as a dollar-quoted string.
    where.push(clause.split("$$").join(`$${params.length}`));
  };

  if (options.search) {
    add("(p.title ilike '%' || $$ || '%' or p.slug ilike '%' || $$ || '%' " +
        "or p.skill ilike '%' || $$ || '%' or p.track ilike '%' || $$ || '%' " +
        "or cur.kit->'concept'->>'question' ilike '%' || $$ || '%' " +
        "or cur.kit->'concept'->>'topic' ilike '%' || $$ || '%')", options.search);
  }
  if (options.track && options.track !== "all") add("p.track = $$", options.track);
  if (options.tracks?.length) add("p.track = any($$::text[])", [...options.tracks]);
  if (options.difficulty && options.difficulty !== "all") {
    add("p.difficulty::text = $$", options.difficulty);
  }
  if (options.artefactType && options.artefactType !== "all") {
    add("p.artefact_type::text = $$", options.artefactType);
  }
  if (options.status && options.status !== "all") {
    const clause = {
      solved: "mine.solved_at is not null",
      attempted: "mine.id is not null and mine.solved_at is null",
      untouched: "mine.id is null",
    }[options.status];
    if (clause) where.push(clause);
  }

  const sql = `
    with stats as (
      select a.problem_id,
             count(*)::int as attempts,
             count(*) filter (where a.solved_at is not null)::int as solved
        from attempt a group by a.problem_id
    )
    select p.id, p.slug, p.title, p.day, p.skill, cur.kit->'scenario'->>'headline' as headline,
           cur.kit->'concept'->>'topic' as topic, cur.kit->'concept'->>'question' as question,
           p.difficulty::text as difficulty, p.track,
           p.artefact_type::text as artefact_type, p.est_minutes, road.ordinal,
           coalesce(stats.attempts, 0) as attempts,
           coalesce(stats.solved, 0) as solved,
           mine.solved_at is not null as is_solved,
           mine.id is not null as is_attempted,
           count(*) over () as total
      from problem p
      left join stats on stats.problem_id = p.id
      left join problem_version cur on cur.problem_id = p.id and cur.version = p.current_version
      left join attempt mine on mine.problem_id = p.id and mine.enrolment_id = $1
      ${ROAD}
     ${where.length ? `where ${where.join(" and ")}` : ""}
     order by ${sort}
     limit ${perPage} offset ${(page - 1) * perPage}`;

  const { rows } = await db().query(sql, params);
  const total = rows.length ? Number(rows[0]!["total"]) : await countAll(options.enrolmentId, where, params);

  return {
    rows: rows.map(toRow),
    total,
    page,
    perPage,
    pages: Math.max(1, Math.ceil(total / perPage)),
  };
}

async function countAll(enrolmentId: number, where: string[], params: unknown[]): Promise<number> {
  const { rows } = await db().query<{ count: string }>(
    `select count(*) from problem p
       left join attempt mine on mine.problem_id = p.id and mine.enrolment_id = $1
       left join problem_version cur on cur.problem_id = p.id and cur.version = p.current_version
      ${where.length ? `where ${where.join(" and ")}` : ""}`, params);
  return Number(rows[0]!.count);
}

function toRow(row: Record<string, any>): CatalogueRow {
  const difficulty = row["difficulty"] as Difficulty;
  const attempts = Number(row["attempts"]);
  const solved = Number(row["solved"]);
  return {
    id: Number(row["id"]),
    slug: row["slug"],
    title: row["title"],
    day: row["day"] === null || row["day"] === undefined ? null : Number(row["day"]),
    skill: row["skill"] ?? null,
    headline: row["headline"] ?? null,
    topic: row["topic"] ?? null,
    question: row["question"] ?? null,
    difficulty,
    track: row["track"],
    artefactType: row["artefact_type"],
    estMinutes: Number(row["est_minutes"]),
    state: row["is_solved"] ? "solved" : row["is_attempted"] ? "attempted" : "untouched",
    // The tier decides whether a solve rate renders. No component reads
    // difficulty to answer that question itself.
    solveRate: tierFor(difficulty).visibility.acceptanceRate && attempts > 0
      ? Math.round((solved / attempts) * 100)
      : null,
    solveRateShown: tierFor(difficulty).visibility.acceptanceRate,
    attemptCount: attempts,
    ordinal: row["ordinal"] === null || row["ordinal"] === undefined ? null : Number(row["ordinal"]),
  };
}

/**
 * The chapter page's Next card: the first unsolved row on the learner's path,
 * so a navigator is not sent to an Easy problem their path leaves for last.
 * Rows no path carries come after every row one does, in the order they were
 * handed over, which is how a chapter with nothing on the path keeps the
 * page's own order.
 */
export function nextOnPath<T extends Pick<CatalogueRow, "ordinal" | "state" | "day">>(
  rows: readonly T[],
): T | undefined {
  const place = (row: T) => row.ordinal ?? Number.MAX_SAFE_INTEGER;
  // A drill has no day, so it comes after every problem on the path.
  const drill = (row: T) => Number(row.day === null);
  return [...rows].sort((a, b) => drill(a) - drill(b) || place(a) - place(b))
    .find((row) => row.state !== "solved");
}

/**
 * Where a chapter with no problems yet sends a learner: the chapter with
 * problems closest to it in path order, the earlier one when two are as
 * close, or null when no chapter has any.
 */
export function nearestWithProblems(chapter: Track, withProblems: readonly string[]): Track | null {
  const at = TRACKS.indexOf(chapter);
  for (let step = 1; step < TRACKS.length; step++) {
    for (const candidate of [TRACKS[at - step], TRACKS[at + step]]) {
      if (candidate && withProblems.includes(candidate)) return candidate;
    }
  }
  return null;
}

export async function facets(): Promise<{ tracks: string[] }> {
  const { rows } = await db().query<{ track: string }>(
    "select distinct track from problem order by track");
  return { tracks: rows.map((r) => r.track) };
}

/** One row of the command palette's index: enough to find a problem and go. */
export interface PaletteProblem {
  slug: string;
  title: string;
  track: string;
  difficulty: Difficulty;
  artefactType: string;
  state: SolveState;
}

/**
 * Every problem in the pool, for the palette to search in the browser.
 *
 * Titles and tracks only, the same fields the catalogue already shows, so the
 * index carries nothing a learner could not read on S3. It comes in the order
 * Problems calls Path order, so the palette's first unsolved rows are the
 * ones Home and Problems open on.
 */
export async function paletteIndex(enrolmentId: number): Promise<PaletteProblem[]> {
  const { rows } = await db().query<{
    slug: string; title: string; track: string; difficulty: Difficulty;
    artefact_type: string; solved: boolean; attempted: boolean;
  }>(
    `select p.slug, p.title, p.track, p.difficulty::text as difficulty,
            p.artefact_type::text as artefact_type,
            mine.solved_at is not null as solved,
            mine.id is not null as attempted
       from problem p
       left join attempt mine on mine.problem_id = p.id and mine.enrolment_id = $1
       ${ROAD}
      order by ${SORTS.roadmap}`, [enrolmentId]);
  return rows.map((row) => ({
    slug: row.slug,
    title: row.title,
    track: row.track,
    difficulty: row.difficulty,
    artefactType: row.artefact_type,
    state: row.solved ? "solved" : row.attempted ? "attempted" : "untouched",
  }));
}
