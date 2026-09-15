/**
 * Rehearsal mode. docs/00 section 7.4 and docs/01 S8.
 *
 * A timed sitting that draws problems matching the learner's persona and runs
 * them under Extreme rules regardless of their native difficulty. The rules
 * themselves are not restated here: the policy module applies them when it is
 * asked with `rehearsal: true`, so a rehearsal and the rest of the product
 * cannot end up with different ideas of what Extreme means.
 */
import type { Pool, PoolClient } from "pg";
import { db, inTransaction } from "../db/pool.ts";
import { consume } from "../policy/caps.ts";
import { roadmapFor } from "../policy/roadmap.ts";
import type { Difficulty } from "../policy/tiers.ts";

/** Long enough to be a sitting, short enough to finish in an evening. */
export const DURATION_MINUTES = 60;
export const PROBLEM_COUNT = 3;

export interface RehearsalProblem {
  problemId: number;
  slug: string;
  title: string;
  /** The problem's own tier. The rules applied are Extreme whatever this says. */
  difficulty: Difficulty;
  track: string;
  ordinal: number;
}

export interface Rehearsal {
  id: number;
  enrolmentId: number;
  startedAt: Date;
  endsAt: Date;
  finishedAt: Date | null;
  problems: RehearsalProblem[];
}

export interface ReportRow extends RehearsalProblem {
  /** Null when the learner never submitted this one inside the sitting. */
  verdict: string | null;
  score: number | null;
  llmCalls: number | null;
}

export interface Report extends Rehearsal {
  problems: ReportRow[];
  passed: number;
  total: number;
  /** Mean score over every problem in the sitting, unattempted ones counting zero. */
  score: number;
  llmCalls: number;
  summary: string;
}

/**
 * Start a sitting.
 *
 * The cap is consumed first. docs/00: rehearsals are capped at two per week per
 * learner so the result stays meaningful, and a learner who starts three and
 * abandons two has still had three sittings' worth of exposure to the problems.
 */
export async function startRehearsal(
  enrolmentId: number, now: Date = new Date(),
): Promise<Rehearsal> {
  const chosen = await selectProblems(enrolmentId);
  if (!chosen.length) {
    throw new Error("No problems are published, so there is nothing to rehearse against.");
  }

  return inTransaction(async (client) => {
    const { rows: enrolment } = await client.query<{ persona: string }>(
      "select persona::text as persona from enrolment where id = $1", [enrolmentId]);
    if (!enrolment[0]) throw new Error(`enrolment ${enrolmentId} not found`);

    await consume(client, {
      enrolmentId,
      problemId: chosen[0]!.problemId,
      // The weekly scope is not per problem, so the difficulty only decides
      // which policy row applies and every row for this scope is the same.
      difficulty: chosen[0]!.difficulty,
      scope: "rehearsal_weekly",
    });

    const endsAt = new Date(now.getTime() + DURATION_MINUTES * 60_000);
    const { rows } = await client.query<{ id: string; started_at: Date; ends_at: Date }>(
      `insert into rehearsal (enrolment_id, ends_at, problem_ids)
       values ($1, $2, $3) returning id, started_at, ends_at`,
      [enrolmentId, endsAt, chosen.map((p) => p.problemId)]);

    return {
      id: Number(rows[0]!.id),
      enrolmentId,
      startedAt: rows[0]!.started_at,
      endsAt: rows[0]!.ends_at,
      finishedAt: null,
      problems: chosen,
    };
  });
}

/**
 * Which problems a sitting draws.
 *
 * The persona roadmap already orders the catalogue for this learner, so the
 * rehearsal takes from it rather than inventing a second ordering that would
 * drift. Unsolved problems come first, because a sitting made of things the
 * learner has already passed measures nothing.
 */
async function selectProblems(
  enrolmentId: number, client: Pool | PoolClient = db(),
): Promise<RehearsalProblem[]> {
  const roadmap = await roadmapFor(enrolmentId, client);
  const unsolved = roadmap.items.filter((item) => !item.solved);
  const pool = unsolved.length >= PROBLEM_COUNT ? unsolved : roadmap.items;

  return pool.slice(0, PROBLEM_COUNT).map((item, index) => ({
    problemId: item.problemId,
    slug: item.slug,
    title: item.title,
    difficulty: item.difficulty,
    track: item.track,
    ordinal: index + 1,
  }));
}

export async function loadRehearsal(
  rehearsalId: number, client: Pool | PoolClient = db(),
): Promise<Rehearsal> {
  const { rows } = await client.query<{
    id: string; enrolment_id: string; started_at: Date; ends_at: Date;
    finished_at: Date | null; problem_ids: string[];
  }>(
    `select id, enrolment_id, started_at, ends_at, finished_at, problem_ids
       from rehearsal where id = $1`, [rehearsalId]);
  const row = rows[0];
  if (!row) throw new Error(`rehearsal ${rehearsalId} not found`);

  const ids = row.problem_ids.map(Number);
  const { rows: problems } = await client.query<{
    id: string; slug: string; title: string; difficulty: Difficulty; track: string;
  }>(
    `select id, slug, title, difficulty::text as difficulty, track
       from problem where id = any($1::bigint[])`, [ids]);
  const byId = new Map(problems.map((p) => [Number(p.id), p]));

  return {
    id: Number(row.id),
    enrolmentId: Number(row.enrolment_id),
    startedAt: row.started_at,
    endsAt: row.ends_at,
    finishedAt: row.finished_at,
    // Ordered by problem_ids, which is the sequence the learner cannot reorder.
    problems: ids.map((id, index) => {
      const problem = byId.get(id)!;
      return {
        problemId: id, slug: problem.slug, title: problem.title,
        difficulty: problem.difficulty, track: problem.track, ordinal: index + 1,
      };
    }),
  };
}

/** The report, computed from the sitting's own submissions. */
export async function reportFor(
  rehearsalId: number, client: Pool | PoolClient = db(),
): Promise<Report> {
  const rehearsal = await loadRehearsal(rehearsalId, client);

  const { rows } = await client.query<{
    problem_id: string; verdict: string | null; score: string | null; llm_calls: number | null;
  }>(
    `select v.problem_id, s.verdict::text, s.score, s.llm_calls
       from submission s
       join problem_version v on v.id = s.problem_version_id
      where s.rehearsal_id = $1
      order by s.id`, [rehearsalId]);

  const byProblem = new Map<number, typeof rows[number]>();
  for (const row of rows) byProblem.set(Number(row.problem_id), row);

  const problems: ReportRow[] = rehearsal.problems.map((problem) => {
    const hit = byProblem.get(problem.problemId);
    return {
      ...problem,
      verdict: hit?.verdict ?? null,
      score: hit?.score === undefined || hit.score === null ? null : Number(hit.score),
      llmCalls: hit?.llm_calls ?? null,
    };
  });

  const passed = problems.filter((row) => row.verdict === "pass").length;
  const total = problems.length;
  // An unattempted problem scores zero rather than being left out. A sitting
  // the learner ran out of time on is a result, not a shorter sitting.
  const score = total === 0 ? 0
    : Math.round(problems.reduce((sum, row) => sum + (row.score ?? 0), 0) / total * 100) / 100;
  const llmCalls = problems.reduce((sum, row) => sum + (row.llmCalls ?? 0), 0);

  return { ...rehearsal, problems, passed, total, score, llmCalls,
           summary: summarise(problems, passed, total) };
}

/** Close the sitting and write the report, which is then read back rather than recomputed. */
export async function finishRehearsal(
  rehearsalId: number, client: Pool | PoolClient = db(),
): Promise<Report> {
  const report = await reportFor(rehearsalId, client);
  await client.query(
    `update rehearsal set finished_at = coalesce(finished_at, now()), report = $2
      where id = $1`,
    [rehearsalId, JSON.stringify(stripDates(report))]);
  return { ...report, finishedAt: report.finishedAt ?? new Date() };
}

function stripDates(report: Report): Record<string, unknown> {
  const { startedAt, endsAt, finishedAt, ...rest } = report;
  void startedAt; void endsAt; void finishedAt;
  return rest as Record<string, unknown>;
}

/**
 * The written summary S8 asks for.
 *
 * Plain arithmetic rather than a judge call: the judge already scored each
 * problem, and spending another model call to restate three numbers would be
 * spending tokens on a sentence.
 */
function summarise(problems: ReportRow[], passed: number, total: number): string {
  const unattempted = problems.filter((row) => row.verdict === null).length;
  const parts = [`${passed} of ${total} passed under Extreme rules.`];
  if (unattempted) {
    parts.push(`${unattempted} ${unattempted === 1 ? "problem was" : "problems were"} ` +
               "never submitted, which counts as zero.");
  }
  const weakest = problems
    .filter((row) => row.verdict !== null && row.verdict !== "pass")
    .map((row) => row.title);
  if (weakest.length) parts.push(`Failed: ${weakest.join(", ")}.`);
  return parts.join(" ");
}
