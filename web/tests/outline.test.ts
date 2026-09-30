/**
 * The outline a written answer can start from. The workspace decides when to
 * use it, from the policy's layers; this decides what it says.
 */
import { describe, expect, it } from "vitest";
import { answerOutline } from "../lib/problems/outline.ts";
import { evaluateDesignStructure } from "../lib/gate/structure.ts";

const approach = {
  goal: "A threshold the head of delivery can act on",
  branches: [
    { label: "Split what blocks from what reports", leaves: [] },
    { label: "Set a number per slice", leaves: [] },
  ],
};

describe("answerOutline", () => {
  it("turns the approach map's branches into headings", () => {
    expect(answerOutline({ requiredHeadings: [], approach }))
      .toBe("## Split what blocks from what reports\n\n## Set a number per slice\n");
  });

  it("prefers the headings the structural gate checks", () => {
    const outline = answerOutline({ requiredHeadings: ["What I would measure"], approach })!;
    expect(outline).toBe("## What I would measure\n");
    const gate = evaluateDesignStructure(outline, { required_headings: ["What I would measure"] });
    expect(gate.checks.find((c) => c.kind === "required_heading")?.status).toBe("pass");
  });

  it("offers nothing when the problem has neither", () => {
    expect(answerOutline({ requiredHeadings: [], approach: null })).toBeNull();
  });
});
