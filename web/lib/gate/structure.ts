/**
 * Structural checks for design arguments. docs/03 section 4.3 step 1.
 *
 * Word count in range, required headings present if declared. Both are cheap
 * and both run before any model call, so an answer that is half the required
 * length never reaches the judge.
 */
import { wordCount, type GateCheck, type StaticGate } from "./rules.ts";

export interface DesignProblem {
  word_range?: [number, number];
  required_headings?: string[];
}

const HEADING = /^\s{0,3}#{1,6}\s+(.*)$/gm;

export function headingsIn(body: string): string[] {
  return [...body.matchAll(HEADING)].map((m) => m[1]!.trim());
}

export function evaluateDesignStructure(body: string, problem: DesignProblem): StaticGate {
  const checks: GateCheck[] = [];
  const range = problem.word_range;

  if (range) {
    const [low, high] = range;
    const count = wordCount(body);
    if (count < low) {
      checks.push({ kind: "word_range", label: `between ${low} and ${high} words`,
        status: "fail", message: `${count} words, which is ${low - count} short of ${low}` });
    } else if (count > high) {
      checks.push({ kind: "word_range", label: `between ${low} and ${high} words`,
        status: "fail", message: `${count} words, which is ${count - high} over ${high}` });
    } else {
      checks.push({ kind: "word_range", label: `between ${low} and ${high} words`,
        status: "pass", message: `${count} words` });
    }
  }

  const present = new Set(headingsIn(body).map((h) => h.toLowerCase()));
  for (const heading of problem.required_headings ?? []) {
    const found = present.has(heading.toLowerCase());
    checks.push({
      kind: "required_heading",
      label: heading,
      status: found ? "pass" : "fail",
      message: found ? "present" : `the heading ${heading} is missing`,
    });
  }

  return { status: checks.every((c) => c.status === "pass") ? "pass" : "fail", checks };
}
