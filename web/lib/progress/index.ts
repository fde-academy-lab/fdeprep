/**
 * Screen S9: the competency heatmap and the attempt history behind it.
 *
 * The heatmap is the readiness signal the placement side reads, so it is built
 * from competency_score and nothing else. Anything that recomputes state here
 * would drift from the scorer that writes it.
 */
import type { Pool, PoolClient } from "pg";
import { db } from "../db/pool.ts";
import { COMPETENCIES } from "../problems/vocabulary.ts";
import { byTier, DIFFICULTIES, type Difficulty } from "../policy/tiers.ts";
import type { State } from "../eval/competency.ts";

export interface HeatCell {
  difficulty: Difficulty;
  state: State;
  updatedAt: string | null;
}

export interface HeatRow {
  slug: string;
  name: string;
  /**
   * One cell per tier, in ladder order.
   *
   * An array rather than a record keyed by difficulty, so that rendering a
   * column or checking a cell never indexes a lookup by tier. The ladder's
   * order is the policy module's to decide and this carries it.
   */
  cells: HeatCell[];
}

export interface Heatmap {
  rows: HeatRow[];
  /** docs/02 section 7: readiness counts clean only. */
  cleanCells: number;
  totalCells: number;
}

const UNTOUCHED = { state: "untouched" as State, updatedAt: null };

/**
 * The full grid, thirteen competencies by four tiers, whether or not a row has
 * ever been touched. A heatmap with rows missing reads as a shorter syllabus
 * rather than as work not yet started.
 */
export async function heatmap(
  enrolmentId: number, client: Pool | PoolClient = db(),
): Promise<Heatmap> {
  const { rows } = await client.query<{
    slug: string; difficulty: Difficulty; state: State; updated_at: Date;
  }>(
    `select c.slug, s.difficulty::text as difficulty, s.state, s.updated_at
       from competency_score s
       join competency c on c.id = s.competency_id
      where s.enrolment_id = $1`, [enrolmentId]);

  const byKey = new Map(rows.map((row) => [`${row.slug}:${row.difficulty}`, row]));

  const grid: HeatRow[] = COMPETENCIES.map((slug) => ({
    slug,
    name: slug.replace(/-/g, " "),
    cells: Object.values(byTier((difficulty): HeatCell => {
      const hit = byKey.get(`${slug}:${difficulty}`);
      return hit
        ? { difficulty, state: hit.state, updatedAt: hit.updated_at.toISOString() }
        : { ...UNTOUCHED, difficulty };
    })),
  }));

  return {
    rows: grid,
    cleanCells: rows.filter((row) => row.state === "clean").length,
    totalCells: COMPETENCIES.length * DIFFICULTIES.length,
  };
}

export interface HistoryRow {
  problemId: number;
  slug: string;
  title: string;
  difficulty: Difficulty;
  /**
   * The latest graded submission's verdict, a submit's or a rehearsal
   * submit's. Null when there is none, or while it waits for one.
   */
  verdict: string | null;
  /** True once the problem has a submit or a rehearsal submit. A Run is not one. */
  submitted: boolean;
  /**
   * When anything on the problem last finished, a Run included, or was queued
   * if it is still waiting.
   */
  lastAt: string | null;
  /** Submits and rehearsal submits. */
  submits: number;
  hintsUsed: number;
  /** Lowest llm_calls across passing submits and rehearsal submits, which is the budget to beat. */
  bestBudgetCalls: number | null;
  callBudget: number | null;
  defenceScore: number | null;
}

/**
 * The submission kinds the history reads a result from: the full battery under
 * the submit caps (docs/00 section 4), the kinds eval/ lets earn passed or
 * clean. A Run checks the public cases alone, so its pass is no result for
 * the problem and its call count covers the public cases only. A defence is
 * scored against the attempt and has its own column. Written out here because
 * progress/ imports nothing that runs from eval/ (docs/12 section 6).
 */
const GRADED = "('submit', 'rehearsal_submit')";

/** What the CSV says of a problem worked on and never submitted. */
export const NOT_SUBMITTED = "not submitted yet";

/** One row per problem attempted, newest activity first. */
export async function attemptHistory(
  enrolmentId: number, client: Pool | PoolClient = db(),
): Promise<HistoryRow[]> {
  const { rows } = await client.query<{
    problem_id: string; slug: string; title: string; difficulty: Difficulty;
    verdict: string | null; submitted: boolean; last_at: Date | null; submits: number;
    hints_used: number; best_budget_calls: number | null; call_budget: number | null;
    defence_score: string | null;
  }>(
    `select p.id as problem_id, p.slug, p.title, p.difficulty::text as difficulty,
            graded.verdict::text as verdict,
            graded.id is not null as submitted,
            latest.at as last_at,
            (select count(*) from submission s
              where s.attempt_id = a.id and s.kind in ${GRADED})::int as submits,
            a.hints_used,
            (select min(s.llm_calls) from submission s
              where s.attempt_id = a.id and s.kind in ${GRADED}
                and s.verdict = 'pass') as best_budget_calls,
            v.call_budget,
            a.defence_score
       from attempt a
       join problem p on p.id = a.problem_id
       join problem_version v on v.problem_id = p.id and v.version = p.current_version
       left join lateral (
         -- When the learner last worked on the problem, which a Run is.
         select coalesce(s.finished_at, s.queued_at) as at from submission s
          where s.attempt_id = a.id
          order by coalesce(s.finished_at, s.queued_at) desc, s.id desc limit 1) latest on true
       left join lateral (
         -- The result. A submission still waiting counts from when it was
         -- queued, so a lost message reads as waiting and not as a submit
         -- never made.
         select s.id, s.verdict from submission s
          where s.attempt_id = a.id and s.kind in ${GRADED}
          order by coalesce(s.finished_at, s.queued_at) desc, s.id desc limit 1) graded on true
      where a.enrolment_id = $1
      order by latest.at desc nulls last, p.slug`,
    [enrolmentId]);

  return rows.map((row) => ({
    problemId: Number(row.problem_id),
    slug: row.slug,
    title: row.title,
    difficulty: row.difficulty,
    verdict: row.verdict,
    submitted: row.submitted,
    lastAt: row.last_at ? row.last_at.toISOString() : null,
    submits: row.submits,
    hintsUsed: row.hints_used,
    bestBudgetCalls: row.best_budget_calls === null ? null : Number(row.best_budget_calls),
    callBudget: row.call_budget === null ? null : Number(row.call_budget),
    defenceScore: row.defence_score === null ? null : Number(row.defence_score),
  }));
}

const CSV_HEADER = "date,problem,difficulty,verdict,submits,hints,budget,defence";

/**
 * docs/00 section 8: export is CSV, because the cohort trackers live in
 * spreadsheets. A title with a comma in it has to survive that trip, so every
 * field goes through the quoting rule rather than the ones that look risky.
 */
export async function historyCsv(
  enrolmentId: number, client: Pool | PoolClient = db(),
): Promise<string> {
  const rows = await attemptHistory(enrolmentId, client);
  const lines = rows.map((row) => [
    row.lastAt ? row.lastAt.slice(0, 10) : "",
    row.title,
    row.difficulty,
    row.verdict ?? (row.submitted ? "" : NOT_SUBMITTED),
    String(row.submits),
    String(row.hintsUsed),
    row.bestBudgetCalls === null
      ? ""
      : `${row.bestBudgetCalls}${row.callBudget === null ? "" : ` of ${row.callBudget}`}`,
    row.defenceScore === null ? "" : String(row.defenceScore),
  ].map(csvField).join(","));

  return [CSV_HEADER, ...lines].join("\n") + "\n";
}

function csvField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
