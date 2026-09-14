/**
 * The static gate, chosen by artefact type.
 *
 * Everything that needs a gate asks here: the checklist in S5, the word count
 * in S6, and the judge worker before it spends a token. A code problem has no
 * static text gate of its own, because its static gate is the AST check that
 * runs inside the runner.
 */
import { evaluatePromptRules, type PromptRule, type StaticGate } from "./rules.ts";
import { evaluateDesignStructure, type DesignProblem } from "./structure.ts";

export type { GateCheck, PromptRule, StaticGate } from "./rules.ts";
export { compilePattern, PatternError, wordCount } from "./rules.ts";
export { evaluateDesignStructure, headingsIn } from "./structure.ts";
export { evaluatePromptRules } from "./rules.ts";

export interface GateProblem extends DesignProblem {
  artefact_type: "code" | "prompt" | "design";
  prompt_rules?: PromptRule[];
}

export function staticGate(problem: GateProblem, body: string): StaticGate {
  if (problem.artefact_type === "prompt") {
    return evaluatePromptRules(body, problem.prompt_rules ?? []);
  }
  if (problem.artefact_type === "design") {
    return evaluateDesignStructure(body, problem);
  }
  return { status: "pass", checks: [] };
}
