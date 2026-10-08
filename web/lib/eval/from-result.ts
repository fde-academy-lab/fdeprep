/**
 * The panel, reading the pipeline that already exists.
 *
 * docs/10 says the three gates in docs/03 become panelist 1 when the panel
 * lands. This is that: it turns a finished result contract into panelist
 * results, so every submission gets an evaluation record without the queue
 * being rewritten first.
 *
 * Nothing here calls a model or runs a battery. The runner and the judge have
 * already done their work by the time a result reaches the writer; this reads
 * what they produced and attributes it.
 */
import { parse } from "yaml";
import { bandForScore } from "../policy/bands.ts";
import { authoredContext, runHeuristics } from "./heuristics.ts";
import { pretrainedPanelist, type PretrainedOptions } from "./pretrained.ts";
import { defaultComplexity, isComplexity, type Complexity } from "../policy/complexity.ts";
import type { Finding, Panelist, PanelistResult } from "./panel.ts";

interface Gate {
  status?: string;
  passed?: number;
  total?: number;
  score?: number;
  /** The rubric gate's score out of a hundred, as judge/handler.py names it. */
  percent?: number;
  checks?: Array<{ rule?: string; status?: string; message?: string | null }>;
  cases?: Array<{ name?: string; status?: string; message?: string | null }>;
  criteria?: unknown[];
}

export interface ResultContract {
  verdict?: string;
  score?: number | null;
  gates?: Record<string, Gate>;
  budget?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Gates the runner and the judge own. Everything here is deterministic. */
const STATIC_GATES = ["static", "public", "hidden", "adversarial", "probes"];

/** The one gate where a model's judgement lives. */
const MODEL_GATE = "rubric";

export function complexityOf(
  artefactType: string,
  declared?: unknown,
): Complexity {
  // A defence is a written argument for a choice the learner already made, so
  // it is a different artefact from the problem it defends and the problem's
  // level does not carry over. Without this, a defence on a C2 code problem
  // would be graded at C2, where the level asks for no model at all, and the
  // judge's band on the argument would be dropped on the floor.
  if (artefactType === "defence") return defaultComplexity("defence");
  return isComplexity(declared) ? declared : defaultComplexity(artefactType);
}

/**
 * Panelist 1, assembled from the deterministic gates.
 *
 * Its verdict is the submission's verdict, because that is what the gates
 * already decided and re-deriving it here would give two answers to one
 * question.
 */
/**
 * What P1 needs beyond the contract, and what P2 needs to reach the database.
 *
 * Separate from the contract because the contract is what the runner and the
 * judge produced, and this is what the problem was authored with. A panelist
 * that had to dig authored content out of a result would be reading the wrong
 * source.
 */
export interface PanelContext {
  /** The problem's YAML, for the heuristics that read authored content. */
  sourceYaml?: string;
  /** The declared call budget, which lives on the version rather than the result. */
  callBudget?: number | null;
  pretrained?: PretrainedOptions;
}

export function staticPanelist(
  contract: ResultContract, context: PanelContext = {},
): Panelist {
  const authored = authoredContext(
    context.sourceYaml ? safeParse(context.sourceYaml) : null);

  return {
    name: "static",
    async run(input): Promise<PanelistResult> {
      const verdict = String(contract.verdict ?? "");
      if (verdict === "error" || verdict === "timeout" || verdict === "") {
        return {
          status: "unavailable",
          reason: verdict || "no_verdict",
          ms: 0,
          findings: [],
        };
      }

      const gates = contract.gates ?? {};
      const findings: Finding[] = [];

      for (const name of STATIC_GATES) {
        const gate = gates[name];
        if (!gate || gate.status === "skipped") continue;

        if (gate.total !== undefined && gate.passed !== undefined) {
          findings.push({
            code: `${name}_gate`,
            detail: gate.status === "pass"
              ? `All ${gate.total} ${name} checks passed.`
              : `${gate.passed} of ${gate.total} ${name} checks passed.`,
            severity: gate.status === "pass" ? "informational" : "blocking",
          });
        }

        // A named case that failed is the most useful sentence a learner can
        // read, so it is lifted out rather than left inside a count.
        for (const item of [...(gate.cases ?? []), ...(gate.checks ?? [])]) {
          if (item.status === "pass" || !item.message) continue;
          findings.push({
            code: `${name}_case`,
            detail: item.message,
            severity: "blocking",
          });
        }
      }

      // docs/10 section 4: the heuristic layer. These never change the verdict
      // and never block, so they run after the gates rather than before: a
      // rule that cannot fail a submission cannot save a model call either,
      // which is what the deterministic-first rule is protecting.
      findings.push(...runHeuristics({
        artefactType: input.artefactType,
        complexity: input.complexity,
        body: input.body,
        brief: authored.brief,
        constraints: authored.constraints,
        llmCalls: numberOrNull((contract.budget ?? {})["llm_calls"]),
        callBudget: context.callBudget ?? null,
      }));

      return {
        status: "ran",
        ms: 0,
        findings,
        verdict: verdict === "pass" ? "pass" : "fail",
        scoreContribution: contract.score ?? null ? Number(contract.score) : 0,
      };
    },
  };
}

/**
 * Panelist 2, when the caller can reach the database.
 *
 * Without that context there is nothing for it to compare against, so it
 * reports skipped rather than unavailable: an evaluation assembled from a bare
 * contract was never going to have a neighbour pool, which is a different
 * thing from an encoder that failed.
 */
export function pretrainedFor(options?: PretrainedOptions): Panelist {
  if (!options) {
    return {
      name: "pretrained",
      async run(): Promise<PanelistResult> {
        return { status: "skipped", reason: "no_pool_context", ms: 0, findings: [] };
      },
    };
  }
  return pretrainedPanelist(options);
}

/**
 * Panelist 3, assembled from the rubric gate the judge already produced.
 *
 * The judge returns a rubric score out of a hundred. That becomes a band here,
 * once, using the thresholds anchored to the authored exemplars. The seat also
 * records which judge prompt produced the score, which is how an evaluation
 * comes to name it.
 */
export function llmPanelist(contract: ResultContract): Panelist {
  return {
    name: "llm",
    async run(input): Promise<PanelistResult> {
      const gate = contract.gates?.[MODEL_GATE];

      if (!gate || gate.status === "skipped") {
        // Skipped because a cheaper gate already failed, which is the
        // deterministic-first rule working rather than an outage.
        return { status: "skipped", reason: "earlier_gate_failed", ms: 0, findings: [] };
      }

      const score = rubricScore(contract, input.artefactType);
      if (score === null) {
        // A defence the word cap stopped never reached a model, which is the
        // same rule as above: the cheaper check failed it, and no re-run is owed.
        if (input.artefactType === "defence" && !gate.criteria?.length) {
          return { status: "skipped", reason: "earlier_gate_failed", ms: 0, findings: [] };
        }
        return { status: "unavailable", reason: "no_rubric_score", ms: 0, findings: [] };
      }

      const prompt = judgePromptOf(contract);
      return {
        status: "ran",
        ms: 0,
        findings: [],
        band: bandForScore(score),
        ...(prompt ? { prompt } : {}),
      };
    },
  };
}

/**
 * The judge's rubric score out of a hundred, or null where the result has none.
 *
 * judge/handler.py writes it on the rubric gate as `percent`, and a defence
 * carries it as the result's own `score`, because the defence's rubric gate
 * holds the criterion and nothing else. `score` on the gate comes first, since
 * the seeded contracts and the tests wrote that name before anything read the
 * judge's. Until S15.3 only `score` was read, so panelist 3 reported every real
 * design, prompt and defence result unavailable, every one of those
 * evaluations went partial, and the free re-run each one promised was owed by
 * a drain that did not exist. Reading the judge's own fields is what lets the
 * drain pay those off without a model call.
 */
export function rubricScore(contract: ResultContract, artefactType: string): number | null {
  const gate = contract.gates?.[MODEL_GATE];
  if (!gate || gate.status === "skipped") return null;
  for (const value of [gate.score, gate.percent]) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  if (artefactType === "defence" && gate.criteria?.length &&
      typeof contract.score === "number" && Number.isFinite(contract.score)) {
    return contract.score;
  }
  return null;
}

/** A file name in judge/prompts/, and nothing that could be a path. */
const PROMPT_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,118}\.md$/;

/**
 * The judge prompt the result names, or null.
 *
 * The judge sets `judge_prompt` only where a prompt graded the answer. A value
 * that is not a plain file name is dropped rather than stored, because faculty
 * read it as the name of a file they can open.
 */
export function judgePromptOf(contract: ResultContract): string | null {
  const value = contract["judge_prompt"];
  return typeof value === "string" && PROMPT_FILE.test(value) && !value.includes("..")
    ? value : null;
}

export function panelistsFor(
  contract: ResultContract,
  context: PanelContext = {},
): Panelist[] {
  return [
    staticPanelist(contract, context),
    pretrainedFor(context.pretrained),
    llmPanelist(contract),
  ];
}

/** A problem whose YAML will not parse still gets graded; it just gets no
 *  heuristics, because the rules that read authored content have nothing. */
function safeParse(source: string): unknown {
  try {
    return parse(source);
  } catch {
    return null;
  }
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
