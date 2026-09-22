/**
 * Panelist 1's heuristic layer. docs/10 section 4.
 *
 * A heuristic is a rule an author writes that needs no model and encodes
 * something a reviewer would notice in two seconds. It produces a finding and
 * never a terminal fail, because a heuristic is a strong hint and not a fact,
 * and docs/10 section 9 reserves terminal failure for deterministic checks a
 * learner can reproduce.
 *
 * Every threshold here was measured against the authored catalogue rather than
 * chosen, and `tests/heuristics.test.ts` runs every rule against every
 * reference in it. A heuristic that fires on a reference is a bug in the
 * heuristic, and that test is the only thing standing between a new rule and a
 * cohort being told their good answers are bad.
 */
import type { Complexity } from "../policy/complexity.ts";
import type { Finding } from "./panel.ts";

export interface HeuristicInput {
  artefactType: string;
  complexity: Complexity;
  /** The learner's answer. */
  body: string;
  /** The problem's brief, which is what `restates_the_brief` compares against. */
  brief: string;
  /** Terms the author says the answer has to engage with. Empty on every
   *  problem in the catalogue today, which is why that rule stays silent. */
  constraints: readonly string[];
  llmCalls: number | null;
  callBudget: number | null;
}

export interface Heuristic {
  name: string;
  artefacts: readonly string[];
  /** The sentence a learner reads, or null when the rule has nothing to say. */
  fires(input: HeuristicInput): string | null;
}

/** Words long enough to carry meaning, which is a cheap stand-in for stopwords. */
function contentWords(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z][a-z'-]{3,}/g) ?? []);
}

function paragraphs(text: string): string[] {
  return text.trim().split(/\n\s*\n/).filter((p) => p.trim().length > 0);
}

/**
 * Markers that compare one option against another.
 *
 * Deliberately narrow. `but` and `while` appear in nearly every answer of any
 * quality and would make this rule unable to fire at all, which is a rule that
 * looks like coverage and provides none.
 */
const TRADE_MARKERS = [
  " rather than", " instead of", "trade-off", "tradeoff", "trade off",
  " versus ", " vs ", "at the cost of", "in exchange for", " whereas ",
  " outweigh", " cheaper than", " worse than", " better than", " stronger than",
  " prefer ", " sacrific", " give up ", " downside",
];

/**
 * Over this share of the answer's vocabulary coming from the brief is a restatement.
 *
 * Measured across all 25 problems and 12 voice questions on 21 September 2026:
 * the highest overlap any authored reference reaches is 0.44, and an *unedited*
 * original prompt, which is the case this rule exists to catch, reaches 0.45.
 * 0.60 sits clear of both.
 */
const RESTATEMENT = 0.6;

/** docs/10 section 4 calls this "a 400-word answer with no structure". */
const STREAM_WORDS = 400;

export const HEURISTICS: readonly Heuristic[] = [
  {
    name: "budget_ignored",
    artefacts: ["code"],
    fires(input) {
      if (input.callBudget === null || input.llmCalls === null) return null;
      if (input.llmCalls <= input.callBudget * 2) return null;
      return `This solution made ${input.llmCalls} model calls against a budget of ` +
             `${input.callBudget}. An agent that calls a model whenever it is unsure ` +
             "costs more than one that decides when to stop.";
    },
  },
  {
    name: "names_no_constraint",
    artefacts: ["design"],
    fires(input) {
      if (!input.constraints.length) return null;
      const body = input.body.toLowerCase();
      if (input.constraints.some((term) => body.includes(term.toLowerCase()))) return null;
      return "This answer does not engage with any of the constraints the brief sets. " +
             "An argument that ignores what the client actually has to live with is " +
             "an argument they cannot act on.";
    },
  },
  {
    name: "no_tradeoff_language",
    artefacts: ["design"],
    fires(input) {
      // C1 to C3 ask for a technique rather than an argument. Wanting a trade
      // in an answer nobody asked one of is the rule firing on the level.
      if (input.complexity !== "C4") return null;
      const body = input.body.toLowerCase();
      if (TRADE_MARKERS.some((marker) => body.includes(marker))) return null;
      return "This answer asserts a position without weighing it against the " +
             "alternative. At this level the question is which cost you are willing " +
             "to pay, so an answer that names no cost has not answered it.";
    },
  },
  {
    name: "restates_the_brief",
    artefacts: ["design", "prompt"],
    fires(input) {
      const answer = contentWords(input.body);
      if (answer.size === 0) return null;
      const brief = contentWords(input.brief);
      if (brief.size === 0) return null;
      let shared = 0;
      for (const word of answer) if (brief.has(word)) shared += 1;
      if (shared / answer.size <= RESTATEMENT) return null;
      return "Most of this answer is the brief in different words. The brief is the " +
             "question, so repeating it back does not answer it.";
    },
  },
  {
    name: "single_paragraph",
    artefacts: ["design"],
    fires(input) {
      if (input.body.trim().split(/\s+/).length < STREAM_WORDS) return null;
      if (paragraphs(input.body).length > 1) return null;
      return "This is a long answer in one unbroken block. An interviewer reading it " +
             "cannot find where one point ends and the next begins, and neither can " +
             "the person who has to act on it.";
    },
  },
];

/** Sorted, so the registry reads as a list rather than as an accident of order. */
export function heuristicNames(): string[] {
  return HEURISTICS.map((h) => h.name).sort();
}

export function isHeuristic(name: string): boolean {
  return HEURISTICS.some((h) => h.name === name);
}

/**
 * Every applicable heuristic, in registry order.
 *
 * Informational, always. docs/10 section 4: a heuristic never produces a
 * terminal fail on its own, and the consolidator reads severity rather than
 * being told separately.
 */
export function runHeuristics(input: HeuristicInput): Finding[] {
  const findings: Finding[] = [];
  for (const heuristic of HEURISTICS) {
    if (!heuristic.artefacts.includes(input.artefactType)) continue;
    const detail = heuristic.fires(input);
    if (detail) findings.push({ code: heuristic.name, detail, severity: "informational" });
  }
  return findings;
}

/** What a problem's YAML supplies to the rules that read authored content. */
export function authoredContext(sourceYaml: unknown): { brief: string; constraints: string[] } {
  const doc = sourceYaml as { brief_md?: unknown; constraints?: unknown } | null;
  const constraints = Array.isArray(doc?.constraints)
    ? doc.constraints.filter((c): c is string => typeof c === "string")
    : [];
  return { brief: typeof doc?.brief_md === "string" ? doc.brief_md : "", constraints };
}
