/**
 * The static rule engine for `prompt_rule`. docs/03 section 4.2 step 1.
 *
 * It lives in the application rather than the runner because it is regex over
 * text and needs no sandbox, and this module is the only copy: the browser
 * checklist in S5 and the submit gate both import it, so what a learner sees
 * as they type is what the server decides on submit.
 *
 * Every rule is evaluated, not just up to the first failure, because the
 * checklist shows all of them at once.
 */

export type RuleKind = "must_remove" | "must_keep" | "max_words" | "min_words";

export interface PromptRule {
  kind: RuleKind;
  label: string;
  pattern?: string;
  numeric_value?: number;
}

export interface GateCheck {
  kind: string;
  label: string;
  status: "pass" | "fail";
  message: string | null;
  line?: number;
}

export interface StaticGate {
  status: "pass" | "fail";
  checks: GateCheck[];
}

export class PatternError extends Error {
  constructor(pattern: string, reason: string) {
    super(`the pattern ${pattern} cannot be used: ${reason}`);
    this.name = "PatternError";
  }
}

const INLINE_FLAGS = /^\(\?([a-zA-Z]+)\)/;
const SUPPORTED_FLAGS: Record<string, string> = { i: "i", s: "s", m: "m" };

/**
 * Problem files write Python regex, so patterns carry inline flag groups like
 * `(?i)`. JavaScript throws on those rather than ignoring them, which would
 * make every pattern in every problem file fail at run time. The leading group
 * is translated into RegExp flags; anything else is a pattern the author has
 * to rewrite, and saying so is better than dropping a flag and quietly
 * changing what the rule matches.
 */
export function compilePattern(pattern: string): RegExp {
  let body = pattern;
  let flags = "";

  const inline = INLINE_FLAGS.exec(pattern);
  if (inline) {
    for (const flag of inline[1]!) {
      const mapped = SUPPORTED_FLAGS[flag];
      if (!mapped) {
        throw new PatternError(pattern,
          `the inline flag (?${flag}) has no JavaScript equivalent, so rewrite the pattern`);
      }
      if (!flags.includes(mapped)) flags += mapped;
    }
    body = pattern.slice(inline[0].length);
  }

  if (INLINE_FLAGS.test(body)) {
    throw new PatternError(pattern, "inline flags are only read at the start of a pattern");
  }

  try {
    return new RegExp(body, flags);
  } catch (error) {
    throw new PatternError(pattern, (error as Error).message);
  }
}

export function wordCount(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length;
}

/** 1-based line the first match falls on, or null when there is no match. */
function lineOfMatch(text: string, pattern: RegExp): number | null {
  const match = pattern.exec(text);
  if (!match) return null;
  return text.slice(0, match.index).split("\n").length;
}

export function evaluatePromptRules(body: string, rules: PromptRule[]): StaticGate {
  const checks = rules.map((rule) => evaluateRule(body, rule));
  return { status: checks.every((c) => c.status === "pass") ? "pass" : "fail", checks };
}

function evaluateRule(body: string, rule: PromptRule): GateCheck {
  const base = { kind: rule.kind, label: rule.label };

  try {
    switch (rule.kind) {
      case "must_remove": {
        const line = lineOfMatch(body, compilePattern(rule.pattern!));
        return line === null
          ? { ...base, status: "pass", message: "gone" }
          : { ...base, status: "fail", line,
              message: `still present at line ${line}` };
      }
      case "must_keep": {
        const found = compilePattern(rule.pattern!).test(body);
        return found
          ? { ...base, status: "pass", message: "kept" }
          : { ...base, status: "fail", message: "no longer in the prompt" };
      }
      case "max_words": {
        const count = wordCount(body);
        return count <= rule.numeric_value!
          ? { ...base, status: "pass", message: `${count} words, within the cap` }
          : { ...base, status: "fail",
              message: `${count} words against a cap of ${rule.numeric_value}` };
      }
      case "min_words": {
        const count = wordCount(body);
        return count >= rule.numeric_value!
          ? { ...base, status: "pass", message: `${count} words` }
          : { ...base, status: "fail",
              message: `${count} words against a floor of ${rule.numeric_value}` };
      }
      default:
        // An unknown kind is never a pass. The validator rejects one before
        // import; this is what happens if a problem somehow gets past it.
        return { ...base, status: "fail",
          message: `the rule kind ${String(rule.kind)} is not one this platform evaluates` };
    }
  } catch (error) {
    return { ...base, status: "fail", message: (error as Error).message };
  }
}
