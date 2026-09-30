/**
 * Screen S3, the problems catalogue.
 *
 * docs/02 section 5: the catalogue reads from `problem`, never from
 * `track_item`, which is what keeps the whole pool open to everyone.
 */
import { db } from "../db/pool.ts";
import { tierFor, type Difficulty } from "../policy/tiers.ts";

export type SolveState = "solved" | "attempted" | "untouched";
export type Sort = "roadmap" | "difficulty" | "recent" | "least_attempted";

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
  difficulty: `${DIFFICULTY_ORDER}, p.title`,
  recent: "p.created_at desc, p.id desc",
  least_attempted: "coalesce(stats.attempts, 0) asc, p.title",
};

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
    where.push(clause.replace("$$", `$${params.length}`));
  };

  if (options.search) {
    add("(p.title ilike '%' || $$ || '%' or p.slug ilike '%' || $$ || '%' " +
        "or p.track ilike '%' || $$ || '%')", options.search);
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
    select p.id, p.slug, p.title, p.difficulty::text as difficulty, p.track,
           p.artefact_type::text as artefact_type, p.est_minutes,
           coalesce(stats.attempts, 0) as attempts,
           coalesce(stats.solved, 0) as solved,
           mine.solved_at is not null as is_solved,
           mine.id is not null as is_attempted,
           count(*) over () as total
      from problem p
      left join stats on stats.problem_id = p.id
      left join attempt mine on mine.problem_id = p.id and mine.enrolment_id = $1
      left join track_item road on road.problem_id = p.id and road.track_id = (
        select t.id from track t join enrolment e on t.slug = 'roadmap-' || e.persona::text
         where e.id = $1)
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
  };
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
 * index carries nothing a learner could not read on S3.
 */
export async function paletteIndex(enrolmentId: number): Promise<PaletteProblem[]> {
  const { rows } = await db().query<{
    slug: string; title: string; track: string; difficulty: Difficulty;
    artefact_type: string; solved: boolean; attempted: boolean;
  }>(
    `select p.slug, p.title, p.track, p.difficulty::text as difficulty,
            p.artefact_type::text as artefact_type,
            bool_or(a.solved_at is not null) is true as solved,
            count(a.id) > 0 as attempted
       from problem p
       left join attempt a on a.problem_id = p.id and a.enrolment_id = $1
      group by p.id
      order by p.track, p.title`, [enrolmentId]);
  return rows.map((row) => ({
    slug: row.slug,
    title: row.title,
    track: row.track,
    difficulty: row.difficulty,
    artefactType: row.artefact_type,
    state: row.solved ? "solved" : row.attempted ? "attempted" : "untouched",
  }));
}
