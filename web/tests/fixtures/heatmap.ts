/**
 * The hand-computed heatmap fixture. Build plan Phase 5, acceptance 4.
 *
 * Both halves of this file are written by hand. SUBMISSIONS is a deliberate
 * history; EXPECTED is what docs/02 section 7 says that history produces,
 * worked out from the table in that section and not from the code under test.
 * If the scorer changes and this file still passes, the change preserved the
 * spec. If it fails, one of the two is wrong and a person has to say which.
 *
 * docs/02 section 7, in full:
 *
 *   untouched  no submission against any problem carrying this competency at
 *              this difficulty
 *   attempted  at least one submission, no pass
 *   passed     at least one passing submission
 *   clean      a passing submission with zero hints revealed and llm_calls at
 *              or under the problem's call budget
 *
 *   Transitions are one-way.
 */

export interface SeededSubmission {
  /** Why this row is in the fixture. */
  note: string;
  slug: string;
  verdict: "pass" | "fail" | "error" | "timeout";
  hintsUsed: number;
  llmCalls: number | null;
}

/**
 * Five problems, six submissions. Every rule in the table above is exercised
 * at least once, and each row says which.
 */
export const SUBMISSIONS: SeededSubmission[] = [
  {
    note: "A clean pass: no hints, four calls against a budget of six.",
    slug: "echo-the-question",           // easy, budget 6, agent-loop
    verdict: "pass", hintsUsed: 0, llmCalls: 4,
  },
  {
    note: "A pass with two hints. Acceptance 3: this is passed, never clean.",
    slug: "carry-state-across-turns",    // medium, budget 6, state-and-memory
    verdict: "pass", hintsUsed: 2, llmCalls: 3,
  },
  {
    note: "A failure, which is attempted, and which carries two competencies.",
    slug: "parse-a-tool-action",         // medium, budget 6, tool-schema-design + agent-loop
    verdict: "fail", hintsUsed: 0, llmCalls: 5,
  },
  {
    note: "A pass over budget: nine calls against six, so passed and not clean.",
    slug: "count-the-failures",          // hard, budget 6, evaluation-design + failure-mode-analysis
    verdict: "pass", hintsUsed: 0, llmCalls: 9,
  },
  {
    note: "An error verdict. Infrastructure noise moves nothing.",
    slug: "survive-the-hostile-tool",    // extreme, budget 6, failure-mode-analysis + system-design
    verdict: "error", hintsUsed: 0, llmCalls: null,
  },
  {
    note: "A later scruffy pass on an already-clean cell. One-way means it stays clean.",
    slug: "echo-the-question",           // easy, agent-loop, again
    verdict: "pass", hintsUsed: 3, llmCalls: 5,
  },
];

/**
 * The heatmap that history produces, worked out by hand.
 *
 * Reading, row by row:
 *
 *   agent-loop at easy      Submission 1 passes with no hints and 4 of 6 calls,
 *                           so clean. Submission 6 passes the same problem with
 *                           three hints, which earns passed, and passed is to
 *                           the left of clean, so the cell does not move.
 *   agent-loop at medium    Submission 3 fails parse-a-tool-action, which
 *                           carries agent-loop. A different difficulty is a
 *                           different cell, so this is attempted and the easy
 *                           cell above is untouched by it.
 *   state-and-memory        Submission 2 passes with two hints revealed. Hints
 *     at medium             cost the clean state and nothing else.
 *   tool-schema-design      The other competency on submission 3's failure.
 *     at medium
 *   evaluation-design       Submission 4 passes with no hints but nine calls
 *     at hard               against a budget of six, so it misses clean on the
 *                           budget half of the rule.
 *   failure-mode-analysis   The other competency on submission 4.
 *     at hard
 *   failure-mode-analysis   Submission 5 errored. An error verdict never
 *     at extreme            consumes an allowance and does not mark a learner
 *                           as having attempted anything, so this stays
 *                           untouched and is absent below.
 *   system-design           Only reachable through submission 5, which errored.
 *     at extreme            Untouched, and absent below.
 *
 * Every cell not listed here is untouched.
 */
export const EXPECTED: Record<string, Partial<Record<string, string>>> = {
  "agent-loop":            { easy: "clean", medium: "attempted" },
  "state-and-memory":      { medium: "passed" },
  "tool-schema-design":    { medium: "attempted" },
  "evaluation-design":     { hard: "passed" },
  "failure-mode-analysis": { hard: "passed" },
};

/** Readiness counts clean only, and there is exactly one clean cell above. */
export const EXPECTED_CLEAN_CELLS = 1;

/** Cells the fixture deliberately leaves untouched, each for a stated reason. */
export const EXPECTED_UNTOUCHED: Array<[string, string, string]> = [
  ["failure-mode-analysis", "extreme", "only reachable through the errored submission"],
  ["system-design", "extreme", "only reachable through the errored submission"],
  ["agent-loop", "hard", "no problem carrying agent-loop at hard was submitted"],
  ["retrieval", "hard", "cite-the-retrieved-chunk was never submitted"],
];

/**
 * Read one cell out of a heatmap.
 *
 * Here rather than in the test body because the tier arrives as an argument,
 * which keeps the "ask the policy module" rule pointed at code that decides
 * behaviour from a tier rather than at a fixture that names one.
 */
export function stateOf(
  grid: { rows: Array<{ slug: string; cells: Array<{ difficulty: string; state: string }> }> },
  slug: string,
  difficulty: string,
): string {
  const row = grid.rows.find((r) => r.slug === slug);
  if (!row) throw new Error(`the heatmap has no row for ${slug}`);
  const cell = row.cells.find((c) => c.difficulty === difficulty);
  if (!cell) throw new Error(`${slug} has no cell at ${difficulty}`);
  return cell.state;
}
