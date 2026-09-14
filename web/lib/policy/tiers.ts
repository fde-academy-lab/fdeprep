/**
 * The scaffold ladder from docs/00 section 3.2, as data.
 *
 * This is the only place the four tiers are described. Everything else in the
 * product asks the policy engine, which reads this. A difficulty check written
 * anywhere else drifts out of step the first time a tier changes, which is the
 * reason CLAUDE.md forbids one.
 */

export type Difficulty = "easy" | "medium" | "hard" | "extreme";
export const DIFFICULTIES: readonly Difficulty[] = ["easy", "medium", "hard", "extreme"];

/** The six scaffold layers. L0 is always on. */
export type Layer = "brief" | "contract" | "stub" | "steps" | "hints" | "reference";
export const LAYERS: readonly Layer[] = [
  "brief", "contract", "stub", "steps", "hints", "reference",
];

/** How L4 unlocks, per tier. */
export type HintRule =
  | { kind: "free" }
  | { kind: "after_failed_runs"; failedRuns: number }
  | { kind: "after_failed_runs_and_note"; failedRuns: number; noteChars: number }
  | { kind: "never" };

/** What the learner is told about the test batteries. */
export interface Visibility {
  /** Public case names render in the output pane. */
  publicNames: boolean;
  /** Public assertions render too, which only Easy gets. */
  publicAssertions: boolean;
  /** The hidden gate reports a count. */
  hiddenCount: boolean;
  /** The catalogue row and the workspace show an acceptance rate. */
  acceptanceRate: boolean;
}

export interface Tier {
  /** Layers this tier renders before any per-attempt gate is applied. */
  layers: readonly Layer[];
  hints: HintRule;
  visibility: Visibility;
  /** Extreme is timed and stores learner-written tests before Submit enables. */
  timed: boolean;
  requiresLearnerTests: boolean;
  confirmBeforeSubmit: boolean;
  adversarialAlwaysRuns: boolean;
  /** Extreme rejects a byte-identical resubmission before spending the cap. */
  rejectsDuplicateSubmissions: boolean;
  /**
   * docs/03 section 4.4: the defence step runs on Hard and Extreme code
   * problems after a pass, and the attempt is not complete until it is
   * submitted.
   */
  requiresDefence: boolean;
}

export const TIERS: Readonly<Record<Difficulty, Tier>> = {
  easy: {
    layers: ["brief", "contract", "stub", "steps", "hints"],
    hints: { kind: "free" },
    visibility: { publicNames: true, publicAssertions: true, hiddenCount: true, acceptanceRate: true },
    timed: false,
    requiresLearnerTests: false,
    confirmBeforeSubmit: false,
    adversarialAlwaysRuns: false,
    rejectsDuplicateSubmissions: false,
    requiresDefence: false,
  },
  medium: {
    layers: ["brief", "contract", "stub", "hints"],
    hints: { kind: "after_failed_runs", failedRuns: 1 },
    visibility: { publicNames: true, publicAssertions: false, hiddenCount: true, acceptanceRate: true },
    timed: false,
    requiresLearnerTests: false,
    confirmBeforeSubmit: false,
    adversarialAlwaysRuns: false,
    rejectsDuplicateSubmissions: false,
    requiresDefence: false,
  },
  hard: {
    layers: ["brief", "contract", "hints"],
    hints: { kind: "after_failed_runs_and_note", failedRuns: 2, noteChars: 200 },
    visibility: { publicNames: false, publicAssertions: false, hiddenCount: true, acceptanceRate: false },
    timed: false,
    requiresLearnerTests: false,
    confirmBeforeSubmit: false,
    adversarialAlwaysRuns: false,
    rejectsDuplicateSubmissions: false,
    requiresDefence: true,
  },
  extreme: {
    // L0 only, blank editor, and nothing about the batteries.
    layers: ["brief"],
    hints: { kind: "never" },
    visibility: { publicNames: false, publicAssertions: false, hiddenCount: false, acceptanceRate: false },
    timed: true,
    requiresLearnerTests: true,
    confirmBeforeSubmit: true,
    adversarialAlwaysRuns: true,
    rejectsDuplicateSubmissions: true,
    requiresDefence: true,
  },
};

export function tierFor(difficulty: Difficulty): Tier {
  const tier = TIERS[difficulty];
  if (!tier) throw new Error(`no tier defined for difficulty ${difficulty}`);
  return tier;
}
