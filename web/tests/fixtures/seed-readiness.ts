/**
 * The readiness of the seed's three named learners, worked out by hand.
 *
 * The test plan (lib/seed/plan.ts, scale "test", TEST_SEED, anchored to 8
 * October 2026) over the fixture catalogue in problems/_fixtures. HISTORY is
 * what the plan gives each named learner, copied out of it; tests/seed.test.ts
 * checks the plan still produces exactly this, so a change to the plan shows
 * up here first. EXPECTED is what docs/02 section 7 and docs/12 section 2 say
 * that history is worth, worked out from those two sections and not from the
 * code under test.
 *
 * The rules, as applied below:
 *
 *   Every run the plan scripts fails a public case, so a problem with a run
 *   is at least attempted in each of its cells.
 *   A pass with no hints and inside the call budget is clean. A pass with a
 *   hint revealed on the attempt, or over budget, is passed. A fail is
 *   attempted. An error or a timeout moves nothing. Cells only move up.
 *   A rehearsal submit counts like any other. A defence after a pass reads
 *   the attempt's hints, so it adds nothing a pass has not already earned.
 *   Readiness is clean cells over the cells the persona's track requires,
 *   floored; a tier off the persona's ladder is optional and required of
 *   nobody. 70 percent with a clean Hard or Extreme cell is screen_ready, 40
 *   to 69 is developing, below 40 is not_ready.
 *
 * The fixture problems and the cells they carry:
 *
 *   Easy     bound-the-agent-loop, echo-the-question       agent-loop
 *            check-what-reaches-the-model                  prompt-hardening
 *            run-a-langgraph-graph                         none
 *   Medium   retry-once-then-degrade                       tool-error-handling
 *            parse-a-tool-action                           tool-schema-design, agent-loop
 *            return-a-parsable-decision                    prompt-construction
 *            carry-state-across-turns                      state-and-memory
 *   Hard     cite-the-retrieved-chunk                      retrieval, context-assembly
 *            harden-the-leaky-prompt                       prompt-hardening, prompt-construction
 *            count-the-failures                            evaluation-design, failure-mode-analysis
 *   Extreme  survive-the-hostile-tool                      failure-mode-analysis, system-design
 *            argue-the-eval-plan                           evaluation-design, client-communication
 *
 * Required cells: a builder (Easy, Medium, Hard) 2 + 5 + 6 = 13; a navigator
 * (Medium, Hard, Extreme) 5 + 6 + 4 = 15; an accelerator (Hard, Extreme)
 * 6 + 4 = 10.
 */

export interface Step {
  daysAgo: number;
  slug: string;
  /** attempt: runs then a submit. rehearsal: one rehearsal submit. */
  kind: "attempt" | "rehearsal";
  outcome: string;
  runs: number;
  hints: number;
}

export interface NamedLearner {
  login: string;
  history: Step[];
  expected: {
    percent: number; band: string; clean: number; passed: number; attempted: number;
    untouched: number; required: number;
  };
  /** The required cells that are clean, as competency/difficulty. */
  cleanCells: string[];
}

const a = (daysAgo: number, slug: string, outcome: string, runs: number, hints = 0): Step =>
  ({ daysAgo, slug, kind: "attempt", outcome, runs, hints });
const r = (daysAgo: number, slug: string, outcome: string): Step =>
  ({ daysAgo, slug, kind: "rehearsal", outcome, runs: 0, hints: 0 });

export const NAMED: NamedLearner[] = [
  {
    // Builder: 13 required cells.
    //   agent-loop/easy        d12 bound fails, d12 echo passes clean        clean
    //   prompt-hardening/easy  d9 timeout after a failed run, d8 clean       clean
    //   tool-error-handling/m  d8 retry clean                               clean
    //   tool-schema-design/m   d6 parse clean                               clean
    //   agent-loop/medium      d6 parse clean                               clean
    //   bound over budget on d10 is passed, below the clean cell already
    //   there; the LangGraph problem carries no cell. The two stuck
    //   submissions have no verdict. Nothing else is touched: 8 untouched.
    //   5 of 13 is 38 percent: not_ready.
    login: "priya-raghavan",
    history: [
      a(12, "bound-the-agent-loop", "fail", 2),
      a(12, "echo-the-question", "clean", 1),
      a(10, "bound-the-agent-loop", "over_budget", 1),
      a(9, "run-a-langgraph-graph", "over_budget", 1),
      a(9, "check-what-reaches-the-model", "timeout", 1),
      a(8, "check-what-reaches-the-model", "clean", 2),
      a(8, "retry-once-then-degrade", "clean", 1),
      a(6, "parse-a-tool-action", "clean", 1),
    ],
    expected: { percent: 38, band: "not_ready", clean: 5, passed: 0, attempted: 0,
                untouched: 8, required: 13 },
    cleanCells: ["agent-loop/easy", "agent-loop/medium", "prompt-hardening/easy",
                 "tool-error-handling/medium", "tool-schema-design/medium"],
  },
  {
    // Navigator: 15 required cells, every one clean.
    //   Medium: retry and parse clean in the d11 rehearsal, carry and return
    //   clean on d11. Hard: cite clean d11, harden and count clean d10 and
    //   d9. Extreme: survive fails d9 (the refused retry adds no row), is
    //   clean in the d8 rehearsal and again d7; argue clean (adequate) d8.
    //   The Easy problems are optional for a navigator: echo and bound clean,
    //   check-what passed with two hints, none of them required.
    //   15 of 15 is 100 percent with clean Hard and Extreme cells: screen_ready.
    login: "tbakare",
    history: [
      r(11, "retry-once-then-degrade", "clean"),
      r(11, "parse-a-tool-action", "clean"),
      a(11, "carry-state-across-turns", "clean", 1),
      a(11, "return-a-parsable-decision", "clean", 0),
      a(11, "cite-the-retrieved-chunk", "clean", 1),
      a(10, "retry-once-then-degrade", "clean", 1),
      a(10, "parse-a-tool-action", "clean", 1),
      a(10, "harden-the-leaky-prompt", "clean", 0),
      a(9, "count-the-failures", "clean", 1),
      a(9, "survive-the-hostile-tool", "fail", 2),
      r(8, "survive-the-hostile-tool", "clean"),
      a(8, "argue-the-eval-plan", "clean", 0),
      a(8, "bound-the-agent-loop", "clean", 1),
      a(8, "echo-the-question", "clean", 2),
      a(7, "survive-the-hostile-tool", "clean", 2),
      a(7, "run-a-langgraph-graph", "fail", 1),
      a(7, "check-what-reaches-the-model", "hinted", 2, 2),
    ],
    expected: { percent: 100, band: "screen_ready", clean: 15, passed: 0, attempted: 0,
                untouched: 0, required: 15 },
    cleanCells: [
      "agent-loop/medium", "client-communication/extreme", "context-assembly/hard",
      "evaluation-design/extreme", "evaluation-design/hard", "failure-mode-analysis/extreme",
      "failure-mode-analysis/hard", "prompt-construction/hard", "prompt-construction/medium",
      "prompt-hardening/hard", "retrieval/hard", "state-and-memory/medium",
      "system-design/extreme", "tool-error-handling/medium", "tool-schema-design/medium",
    ],
  },
  {
    // Accelerator: 10 required cells.
    //   evaluation-design/hard, failure-mode-analysis/hard   count clean d13   clean
    //   retrieval/hard, context-assembly/hard   cite passed with one hint d11  passed
    //   prompt-hardening/hard, prompt-construction/hard   harden errors d10,
    //                                                      clean d9          clean
    //   evaluation-design/x, client-communication/x   argue clean (strong) d7  clean
    //   failure-mode-analysis/x, system-design/x   survive fails d6, d3, d1   attempted
    //   The Easy problems are optional for an accelerator. 6 of 10 is 60
    //   percent: developing.
    login: "maricel-dizon",
    history: [
      a(13, "count-the-failures", "clean", 1),
      a(11, "cite-the-retrieved-chunk", "hinted", 1, 1),
      a(10, "harden-the-leaky-prompt", "error", 0),
      a(9, "harden-the-leaky-prompt", "clean", 0),
      a(7, "argue-the-eval-plan", "clean", 0),
      a(6, "survive-the-hostile-tool", "fail", 1),
      a(3, "survive-the-hostile-tool", "fail", 1),
      a(2, "bound-the-agent-loop", "timeout", 2),
      a(1, "survive-the-hostile-tool", "fail", 1),
      a(1, "bound-the-agent-loop", "clean", 2),
      a(0, "echo-the-question", "over_budget", 2),
    ],
    expected: { percent: 60, band: "developing", clean: 6, passed: 2, attempted: 2,
                untouched: 0, required: 10 },
    cleanCells: ["client-communication/extreme", "evaluation-design/extreme",
                 "evaluation-design/hard", "failure-mode-analysis/hard",
                 "prompt-construction/hard", "prompt-hardening/hard"],
  },
];
