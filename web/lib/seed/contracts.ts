/**
 * The result contracts the seed hands to writeResult.
 *
 * In production the runner and the judge produce these. The seed scripts
 * them, in the shape docs/03 section 5 fixes and tests/eval-wiring.test.ts
 * drives, and writeResult grades a scripted one exactly as it grades a real
 * one: eval/ turns the contract into a verdict, a band and a competency
 * state. Nothing here is a grade.
 *
 * Scores follow the formula the runner applies (runner/battery/result.py)
 * and the judge's own weights (judge/handler.py), and hidden and adversarial
 * cases are withheld until the learner has passed, as docs/03 section 5 and
 * the runner both require, so a seeded result reads like one a learner could
 * have been sent.
 */
import { bandScore, type Band } from "../policy/bands.ts";
import { tierFor, type Difficulty } from "../policy/tiers.ts";
import type { Outcome } from "./plan.ts";

/** What a contract needs to know about its problem. */
export interface ContractProblem {
  artefactType: "code" | "prompt" | "design";
  difficulty: Difficulty;
  callBudget: number | null;
  timeLimitS: number;
  tests: { public: string[]; hidden: string[]; adversarial: string[] };
  probes: Array<{ name: string; type: string }>;
  rules: Array<{ kind: string; label: string }>;
  rubric: Array<{ id: string; label: string; weight: number }>;
  /** The adequate exemplar's score, which judge/handler.py takes as the pass mark. */
  threshold: number | null;
  defenceCriterion: { label: string; weight: number } | null;
}

export interface ContractContext {
  /** Hints revealed on the attempt before this submission. */
  hints: number;
  /** The rubric band a design answer is scripted to land. */
  band?: Band;
  /** Whether the learner had passed this problem before, which reveals hidden case names. */
  alreadyPassed: boolean;
  /** A few words of the body, quoted as rubric evidence the way the judge quotes. */
  quote: string;
}

/** A run that fails a public case: what the plan scripts before every submit. */
export type ContractOutcome = Outcome | "run_fail";

const WEIGHTS = { public: 30, hidden: 70 };
const HINT_PENALTY = 5;
const HINT_PENALTY_CAP = 25;
const BUDGET_PENALTY = 10;
const PROBE_WEIGHT = 40;
const RUBRIC_WEIGHT = 60;
/** "Prompt pass: static and probes pass, rubric score 84." */
const PROMPT_RUBRIC = 84;
const CASE_FAILED = "return value did not equal the expected string";

export function contractFor(
  problem: ContractProblem, outcome: ContractOutcome, context: ContractContext,
): Record<string, unknown> {
  if (outcome === "error" || outcome === "timeout") return failure(problem, outcome);
  if (problem.artefactType === "code") return codeContract(problem, outcome, context);
  if (problem.artefactType === "prompt") return promptContract(problem, outcome, context);
  return designContract(problem, outcome, context);
}

/** The defence after a Hard or Extreme pass: one criterion, scored out of a hundred. */
export function defenceContract(
  problem: ContractProblem, score: number, quote: string,
): Record<string, unknown> {
  const criterion = problem.defenceCriterion;
  if (!criterion) throw new Error("a defence needs the problem's defence criterion");
  return {
    verdict: "pass",
    score,
    gates: {
      static: { status: "pass", checks: [] },
      probes: skipped(0),
      rubric: {
        status: "pass", percent: score, score,
        criteria: [{ criterion_id: "c1", label: criterion.label, weight: criterion.weight,
                     score: Math.round((criterion.weight * score) / 100),
                     evidence_quote: quote, quote_grounded: true }],
      },
    },
    model_calls: 1,
    consumes_allowance: true,
    requeue: false,
  };
}

/* ------------------------------------------------------------------ code */

function codeContract(
  problem: ContractProblem, outcome: ContractOutcome, context: ContractContext,
): Record<string, unknown> {
  const { tests } = problem;
  const passed = outcome === "clean" || outcome === "hinted" || outcome === "over_budget";
  const failsPublic = outcome === "run_fail" || (outcome === "fail" && tests.hidden.length === 0);

  const publicGate = gate(tests.public, failsPublic ? 1 : 0, true);
  const hiddenRan = publicGate.status === "pass";
  const hiddenGate = hiddenRan
    ? gate(tests.hidden, outcome === "fail" ? 1 : 0, context.alreadyPassed)
    : skipped(tests.hidden.length);
  const adversarialRan = hiddenRan && hiddenGate.status === "pass";
  const adversarialGate = adversarialRan
    ? gate(tests.adversarial, 0, context.alreadyPassed)
    : skipped(tests.adversarial.length);

  const budget = problem.callBudget;
  const llmCalls = outcome === "over_budget" ? (budget ?? 0) + 2
    : budget === null ? 2 : Math.floor(budget / 2);
  const withinBudget = budget === null || llmCalls <= budget;

  let base = passed ? 100
    : WEIGHTS.public * ratio(publicGate) + WEIGHTS.hidden * ratio(hiddenGate);
  const cap = tierFor(problem.difficulty).adversarialRequiredAbove;
  if (cap !== null && adversarialGate.status !== "pass") base = Math.min(base, cap);
  const penalty = Math.min(context.hints * HINT_PENALTY, HINT_PENALTY_CAP) +
    (withinBudget ? 0 : BUDGET_PENALTY);

  return {
    verdict: passed ? "pass" : "fail",
    score: round(Math.max(0, base - penalty)),
    gates: {
      static: { status: "pass", reasons: [] },
      public: publicGate,
      hidden: hiddenGate,
      adversarial: adversarialGate,
    },
    budget: {
      llm_calls: llmCalls, tool_calls: Math.max(1, llmCalls), wall_ms: 400 + llmCalls * 90,
      max_llm_calls: budget, within_budget: withinBudget,
    },
    consumes_allowance: true,
    runner: { image_tag: "runner:seed", duration_ms: 900 + llmCalls * 120 },
    trace: trace(tests.public, llmCalls, outcome === "run_fail"),
  };
}

function gate(names: string[], failing: number, reveal: boolean) {
  const cases = names.map((name, index) => ({
    name,
    status: index >= names.length - failing ? "fail" : "pass",
    message: index >= names.length - failing ? CASE_FAILED : null,
  }));
  const passed = cases.filter((c) => c.status === "pass").length;
  return {
    status: passed === cases.length ? "pass" : "fail",
    passed,
    total: cases.length,
    cases: reveal ? cases : [],
  };
}

function skipped(total: number) {
  return { status: "skipped", passed: 0, total, cases: [] as unknown[] };
}

function ratio(g: { passed: number; total: number }): number {
  return g.total ? g.passed / g.total : 0;
}

/**
 * A handful of steps per public case, enough for storeTrace to keep a trace
 * and for the Submissions tab's trace link to open one. A failing run calls
 * the same tool twice in a row, which is the flag docs/03 section 6 exists for.
 */
function trace(cases: string[], llmCalls: number, repeats: boolean) {
  return {
    submission_id: 0,
    cases: cases.slice(0, 2).map((name) => {
      const steps: Array<Record<string, unknown>> = [];
      let seq = 1;
      for (let turn = 1; turn <= Math.max(1, llmCalls); turn += 1) {
        steps.push({ seq: seq++, type: "llm_call", prompt: `${name}, turn ${turn}`,
                     prompt_chars: 180 + turn * 40, response: "Action: lookup", ms: 0 });
        steps.push({ seq: seq++, type: "tool_call", tool: "lookup", args: { turn }, ms: 1 });
        steps.push({ seq: seq++, type: "observation", value: { status: 200 }, ms: 0 });
      }
      if (repeats) {
        steps.push({ seq: seq++, type: "tool_call", tool: "lookup", args: { turn: llmCalls }, ms: 1,
                     flags: ["repeated_identical_tool_call"] });
      }
      steps.push({ seq: seq++, type: "final", value: "done" });
      return {
        name,
        trace: { steps, flags: repeats ? ["repeated_identical_tool_call"] : [], truncated: false },
      };
    }),
  };
}

/* ------------------------------------------------------------- judged */

function promptContract(
  problem: ContractProblem, outcome: ContractOutcome, context: ContractContext,
): Record<string, unknown> {
  const passed = outcome !== "fail";
  const probes = problem.probes.map((probe, index) => ({
    name: probe.name,
    status: !passed && index === problem.probes.length - 1 ? "fail" : "pass",
    detail: null,
    assertion: { type: probe.type },
  }));
  const probesPassed = probes.filter((p) => p.status === "pass").length;
  const probeRatio = probes.length ? probesPassed / probes.length : 1;
  const gates = {
    static: { status: "pass",
              checks: problem.rules.map((r) => ({ ...r, status: "pass", message: null })) },
    probes: { status: probesPassed === probes.length ? "pass" : "fail",
              passed: probesPassed, total: probes.length, cases: probes },
    rubric: passed ? rubricGate(problem, PROMPT_RUBRIC, context.quote) : skipped(0),
  };
  const base = passed
    ? PROBE_WEIGHT * probeRatio + RUBRIC_WEIGHT * (PROMPT_RUBRIC / 100)
    : PROBE_WEIGHT * probeRatio;
  return judged(passed ? "pass" : "fail", base, context.hints, gates, probes.length * 2 + 2);
}

/**
 * A design answer lands the planned band through the judge's rubric score:
 * strong at 90, adequate at the adequate exemplar's own score or 63,
 * whichever is higher, so it clears the pass mark, and weak at 29, below it.
 */
function designContract(
  problem: ContractProblem, outcome: ContractOutcome, context: ContractContext,
): Record<string, unknown> {
  const band: Band = context.band ?? (outcome === "fail" ? "weak" : "strong");
  const percent = band === "adequate" ? Math.max(bandScore("adequate"), problem.threshold ?? 0)
    : bandScore(band);
  const rubric = rubricGate(problem, percent, context.quote);
  const gates = {
    static: { status: "pass", checks: [] },
    probes: skipped(0),
    rubric,
  };
  return judged(rubric.status === "pass" ? "pass" : "fail", percent, context.hints, gates, 2);
}

/**
 * The rubric gate as the judge writes it, which carries `percent`, plus the
 * `score` lib/eval/from-result.ts reads to place panelist 3. The real judge
 * writes percent alone; see the pull request.
 */
function rubricGate(problem: ContractProblem, percent: number, quote: string) {
  const status = problem.threshold === null || percent >= problem.threshold ? "pass" : "fail";
  return {
    status,
    percent,
    score: percent,
    total: percent,
    max_total: 100,
    threshold: problem.threshold,
    criteria: problem.rubric.map((criterion) => ({
      criterion_id: criterion.id,
      label: criterion.label,
      weight: criterion.weight,
      score: round((criterion.weight * percent) / 100),
      evidence_quote: quote,
      quote_grounded: true,
    })),
  };
}

function judged(
  verdict: "pass" | "fail", base: number, hints: number, gates: Record<string, unknown>,
  modelCalls: number,
): Record<string, unknown> {
  return {
    verdict,
    score: round(Math.max(0, base - Math.min(hints * HINT_PENALTY, HINT_PENALTY_CAP))),
    gates,
    model_calls: modelCalls,
    consumes_allowance: true,
    requeue: false,
  };
}

/* ------------------------------------------------------------- failures */

/**
 * The platform's failure, never the learner's: consumes_allowance false and
 * no score, so writeResult refunds the unit and eval/ records an error that
 * moves no competency cell. The messages are the runner's and the judge's own.
 */
function failure(problem: ContractProblem, outcome: "error" | "timeout"): Record<string, unknown> {
  if (problem.artefactType !== "code") {
    return {
      verdict: "error",
      score: null,
      message: "The judge could not reach the model. Your attempt was not counted. Try again.",
      gates: { static: skipped(0), probes: skipped(0), rubric: skipped(0) },
      model_calls: 0,
      consumes_allowance: false,
      requeue: false,
    };
  }
  return {
    verdict: outcome,
    score: null,
    message: outcome === "timeout"
      ? `The runner timed out after ${problem.timeLimitS} seconds. Your attempt was not counted. ` +
        "Try again."
      : "The runner did not complete. Your attempt was not counted. Try again.",
    consumes_allowance: false,
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
