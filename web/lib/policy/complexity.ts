/**
 * Complexity, which is not difficulty. docs/10 section 3.
 *
 * Difficulty decides how much support a learner gets and which caps apply, and
 * `tiers.ts` owns it. Complexity decides what shape the answer has and
 * therefore which panelists can check it, and this file owns that. They are
 * orthogonal on purpose: a Hard problem can ask a C2 question and an Easy
 * problem can ask a C4 one.
 *
 * Nothing outside the policy module reads either axis directly. The rule in
 * CLAUDE.md that forbids a scattered difficulty check applies here for the same
 * reason: a level's meaning changes, and a check written elsewhere drifts.
 */

/**
 * Four levels. C4 is the top, and the reason is worth knowing before adding a
 * fifth: a level exists to say which panelists can check an answer, so a level
 * naming a panelist nothing implements is a level that misleads an author into
 * declaring something the pipeline silently cannot supply. docs/10 section 3
 * records the decision and what a fifth level would have to come with.
 */
export type Complexity = "C1" | "C2" | "C3" | "C4";
export const COMPLEXITIES: readonly Complexity[] = ["C1", "C2", "C3", "C4"];

/** Named for the shape of the answer, which is what decides who can check it. */
export const COMPLEXITY_NAMES: Readonly<Record<Complexity, string>> = {
  C1: "recall",
  C2: "application",
  C3: "synthesis",
  C4: "judgement",
};

export type Demand = "required" | "optional" | "no";

export interface PanelDemand {
  /** Always required. The outage fallback is structural, not remembered. */
  static: "required";
  pretrained: Demand;
  llm: Demand;
  /**
   * How many graded answers have to sit near a submission before panelist 2's
   * band counts at this level.
   *
   * One neighbour produces a weighted vote of confidence 1.00 by construction,
   * since that neighbour holds all the weight, so the split-neighbours warning
   * cannot fire exactly when the evidence is thinnest. Measured across the 11
   * authored problems with rubrics: a fresh three-exemplar pool supplies a
   * median of two neighbours above the similarity floor, so a bar of two
   * restrains the panelist and a bar of three would silence it.
   */
  minimumNeighbours: number;
}

const DEMANDS: Readonly<Record<Complexity, PanelDemand>> = {
  // One right answer, and it is short. A model call here is waste that
  // compounds across a cohort.
  C1: { static: "required", pretrained: "no", llm: "no",
        minimumNeighbours: 1 },
  // The battery decides a C2 grade. A band from one neighbour is a garnish on
  // a verdict that does not depend on it, so there is nothing to protect.
  C2: { static: "required", pretrained: "optional", llm: "no",
        minimumNeighbours: 1 },
  C3: { static: "required", pretrained: "required", llm: "optional",
        minimumNeighbours: 2 },
  // No single right answer, so a panel of one would be guessing.
  C4: { static: "required", pretrained: "required", llm: "required",
        minimumNeighbours: 2 },
};

export function panelFor(complexity: Complexity): PanelDemand {
  return DEMANDS[complexity];
}

export function isComplexity(value: unknown): value is Complexity {
  return typeof value === "string" && (COMPLEXITIES as readonly string[]).includes(value);
}

/**
 * What a problem gets when it carries no `complexity` of its own.
 *
 * Every problem in problems/ now declares one and the validator requires it,
 * so this is no longer the path a problem takes. Two callers remain.
 *
 * A defence has no problem of its own: it is a written argument about a choice
 * the learner already made, so it takes the level this returns rather than the
 * level of the problem it defends.
 *
 * And a submission whose problem version predates the backfill still has to
 * grade rather than throw, since `evaluation` rows outlive the YAML they were
 * written against.
 */
export function defaultComplexity(artefactType: string): Complexity {
  switch (artefactType) {
    case "code":
      return "C2";
    case "prompt":
      return "C3";
    case "design":
      return "C4";
    case "voice":
      return "C4";
    // A defence is a written argument for a choice the learner already made,
    // judged rather than executed, so it sits where design does.
    case "defence":
      return "C4";
    default:
      return "C3";
  }
}

/**
 * Whether this artefact type produces a score from deterministic gates alone.
 *
 * Code does: the public, hidden and adversarial ratios are the score, by the
 * formula in docs/03 section 5. Design does not, so its score comes from the
 * band. Prompt and voice sit in between and take the band for the rubric half.
 */
export function hasDeterministicScore(artefactType: string): boolean {
  return artefactType === "code";
}
