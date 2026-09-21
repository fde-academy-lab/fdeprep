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

export type Complexity = "C1" | "C2" | "C3" | "C4" | "C5";
export const COMPLEXITIES: readonly Complexity[] = ["C1", "C2", "C3", "C4", "C5"];

/** Named for the shape of the answer, which is what decides who can check it. */
export const COMPLEXITY_NAMES: Readonly<Record<Complexity, string>> = {
  C1: "recall",
  C2: "application",
  C3: "synthesis",
  C4: "judgement",
  C5: "open",
};

export type Demand = "required" | "optional" | "no";

export interface PanelDemand {
  /** Always required. The outage fallback is structural, not remembered. */
  static: "required";
  pretrained: Demand;
  llm: Demand;
  /** C5 asks a second model, so disagreement is visible rather than assumed. */
  secondModel: boolean;
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
  C1: { static: "required", pretrained: "no", llm: "no", secondModel: false,
        minimumNeighbours: 1 },
  // The battery decides a C2 grade. A band from one neighbour is a garnish on
  // a verdict that does not depend on it, so there is nothing to protect.
  C2: { static: "required", pretrained: "optional", llm: "no", secondModel: false,
        minimumNeighbours: 1 },
  C3: { static: "required", pretrained: "required", llm: "optional", secondModel: false,
        minimumNeighbours: 2 },
  C4: { static: "required", pretrained: "required", llm: "required", secondModel: false,
        minimumNeighbours: 2 },
  // No single right answer, so a panel of one would be guessing.
  C5: { static: "required", pretrained: "required", llm: "required", secondModel: true,
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
 * Nothing in problems/ declares it yet. Without a default the panel could not
 * run against today's catalogue at all, and a backfill would have to land
 * before any of this could be exercised. These are the levels the artefact
 * types already imply: a code problem applies a known technique to a fixed
 * case, and a design answer argues a trade-off with no single right answer.
 *
 * An explicit `complexity` in the YAML always wins. Once the backfill lands the
 * validator requires one and this becomes dead weight worth deleting.
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
