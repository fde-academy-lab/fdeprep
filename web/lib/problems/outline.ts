/**
 * The outline a written answer can start from, so no workspace opens on a
 * blank page. A design answer's stub, in the sense docs/00 section 3.2 gives
 * every tier one.
 *
 * The problem's own required headings come first, because the structural
 * gate checks them. Otherwise the outline is the approach map's branches,
 * which the author already wrote as the parts of a good answer and which the
 * learner can see in the guide anyway. Headings only: what goes under them is
 * the answer.
 */
import type { Approach } from "./kit.ts";

export function answerOutline(problem: {
  requiredHeadings: readonly string[];
  approach: Approach | null;
}): string | null {
  const headings = problem.requiredHeadings.length
    ? problem.requiredHeadings
    : (problem.approach?.branches ?? []).map((branch) => branch.label);
  if (!headings.length) return null;
  return headings.map((heading) => `## ${heading}\n\n`).join("").trimEnd() + "\n";
}
