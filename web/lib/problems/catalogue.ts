/**
 * Screen S3, the problems catalogue.
 *
 * docs/02 section 5: the catalogue reads from `problem`, never from
 * `track_item`, which is what keeps the whole pool open to everyone.
 */
import { db } from "../db/pool.ts";
import { policyFor, type Difficulty } from "../policy/difficulty.ts";

export type SolveState = "solved" | "attempted" | "untouched";
export type Sort = "roadmap" | "difficulty" | "recent" | "least_attempted";

export interface CatalogueFilters {
  search?: string;
  track?: string;
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
  /** Null when the tier hides it, which the policy module decides. */
  solveRate: number | null;
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
  roadmap: `${DIFFICULTY_ORDER}, p.track, p.id`,
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
    solveRate: policyFor(difficulty).showsSolveRate && attempts > 0
      ? Math.round((solved / attempts) * 100)
      : null,
    attemptCount: attempts,
  };
}

export async function facets(): Promise<{ tracks: string[] }> {
  const { rows } = await db().query<{ track: string }>(
    "select distinct track from problem order by track");
  return { tracks: rows.map((r) => r.track) };
}
