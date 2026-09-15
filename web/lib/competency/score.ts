/**
 * Competency state transitions from docs/02 section 7.
 *
 * Transitions are one-way and computed on every finished submission.
 *
 *   untouched  no submission against a problem carrying this competency here
 *   attempted  at least one submission, no pass
 *   passed     at least one passing submission
 *   clean      a passing submission with zero hints revealed and llm_calls
 *              at or under the problem's call budget
 *
 * Readiness counts `clean` only. A pass with four hints is progress and is not
 * evidence, so `clean` never degrades to `passed` on a later scruffy run.
 *
 * One deviation from the literal text of docs/02 section 7, which defines
 * `attempted` as "at least one submission, no pass". Only a verdict the learner
 * earned counts here: error, timeout, cancelled and rejected move nothing. An
 * error verdict already never consumes an allowance, and for the same reason it
 * should not mark someone as having attempted a competency. The heatmap is the
 * readiness signal the placement side reads, and a runner that died is not
 * evidence about a learner.
 */
import type { PoolClient } from "pg";

export type State = "untouched" | "attempted" | "passed" | "clean";

/** Higher wins. One-way means a transition never moves left. */
const RANK: Record<State, number> = { untouched: 0, attempted: 1, passed: 2, clean: 3 };

export function isUpgrade(from: State, to: State): boolean {
  return RANK[to] > RANK[from];
}

/** Verdicts that say something about the learner rather than about the platform. */
const EARNED = new Set(["pass", "fail"]);

/**
 * What this submission earns, before it is merged with what was already there.
 * Null when the verdict says nothing about the learner, which leaves the cell
 * exactly as it was.
 */
export function stateForSubmission(input: {
  verdict: string | null;
  hintsUsed: number;
  llmCalls: number | null;
  callBudget: number | null;
}): State | null {
  if (!input.verdict || !EARNED.has(input.verdict)) return null;
  if (input.verdict !== "pass") return "attempted";
  const withinBudget =
    input.callBudget === null || input.llmCalls === null || input.llmCalls <= input.callBudget;
  return input.hintsUsed === 0 && withinBudget ? "clean" : "passed";
}

/**
 * Apply the transition for one finished submission across every competency the
 * problem carries. Runs inside the result writer's transaction.
 */
export async function applyForSubmission(
  client: PoolClient, submissionId: number,
): Promise<Array<{ competencyId: number; from: State; to: State }>> {
  const { rows } = await client.query<{
    enrolment_id: string; difficulty: string; verdict: string | null;
    hints_used: number; llm_calls: number | null; call_budget: number | null;
    competency_id: string;
  }>(
    `select a.enrolment_id, p.difficulty::text as difficulty, s.verdict::text,
            a.hints_used, s.llm_calls, v.call_budget, pc.competency_id
       from submission s
       join attempt a on a.id = s.attempt_id
       join problem_version v on v.id = s.problem_version_id
       join problem p on p.id = v.problem_id
       join problem_competency pc on pc.problem_id = p.id
      where s.id = $1`, [submissionId]);

  const changes: Array<{ competencyId: number; from: State; to: State }> = [];

  for (const row of rows) {
    const earned = stateForSubmission({
      verdict: row.verdict,
      hintsUsed: row.hints_used,
      llmCalls: row.llm_calls,
      callBudget: row.call_budget,
    });
    if (earned === null) continue;

    const existing = await client.query<{ state: State }>(
      `select state from competency_score
        where enrolment_id = $1 and competency_id = $2 and difficulty = $3::difficulty
        for update`,
      [row.enrolment_id, row.competency_id, row.difficulty]);

    const from = existing.rows[0]?.state ?? "untouched";
    if (!isUpgrade(from, earned)) continue;

    await client.query(
      `insert into competency_score (enrolment_id, competency_id, difficulty, state)
       values ($1, $2, $3::difficulty, $4)
       on conflict (enrolment_id, competency_id, difficulty)
       do update set state = excluded.state, updated_at = now()`,
      [row.enrolment_id, row.competency_id, row.difficulty, earned]);

    changes.push({ competencyId: Number(row.competency_id), from, to: earned });
  }

  return changes;
}

/** The heatmap read. Readiness counts clean only. */
export async function heatmapFor(
  client: PoolClient | import("pg").Pool, enrolmentId: number,
): Promise<Array<{ slug: string; difficulty: string; state: State }>> {
  const { rows } = await client.query<{ slug: string; difficulty: string; state: State }>(
    `select c.slug, cs.difficulty::text as difficulty, cs.state
       from competency_score cs join competency c on c.id = cs.competency_id
      where cs.enrolment_id = $1
      order by c.slug, cs.difficulty`, [enrolmentId]);
  return rows;
}
