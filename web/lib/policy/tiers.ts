/**
 * The scaffold ladder from docs/00 section 3.2, as data.
 *
 * Amended 29 September 2026. The ladder used to withhold starter code on Hard
 * and Extreme and every hint on Extreme, to imitate a screen. Learners read
 * that as a blank page with nobody to ask. Every tier now gets starter code,
 * whose depth the author sets per tier (a full scaffold on Easy, the signature
 * and its contract on Extreme), and a hint ladder whose unlock tightens with
 * the tier. Screen conditions did not go away: they are SCREEN_CONDITIONS
 * below, which the rehearsal applies and nothing else.
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

/**
 * How much the live coach says. Added with the 29 September 2026 amendment.
 *
 * The coach reads the learner's code with author-written patterns, so a
 * code-reading nudge is close to a hint. On Easy and Medium it speaks as soon
 * as the code shows the mistake. Hard and Extreme get a clean first attempt:
 * code-reading nudges wait for failed runs, the same currency hints cost, and
 * nudges about a failed test speak once there is a failed test to speak about.
 * Under screen conditions the coach is off, because an interviewer does not
 * coach.
 */
export interface CoachRule {
  enabled: boolean;
  codeSignalsAfterFailedRuns: number;
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
  coach: CoachRule;
  /**
   * Whether the traps, the mistakes the hidden cases catch, show before the
   * attempt closes. Added 1 October 2026. Easy and Medium name them up front
   * as teaching; Hard and Extreme keep the hidden battery a test of judgement
   * and name them once the attempt is solved or given up.
   */
  trapsBeforeAttempt: boolean;
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
    coach: { enabled: true, codeSignalsAfterFailedRuns: 0 },
    trapsBeforeAttempt: true,
  },
  medium: {
    layers: ["brief", "contract", "stub", "steps", "hints"],
    hints: { kind: "after_failed_runs", failedRuns: 1 },
    visibility: { publicNames: true, publicAssertions: false, hiddenCount: true, acceptanceRate: true },
    timed: false,
    requiresLearnerTests: false,
    confirmBeforeSubmit: false,
    adversarialAlwaysRuns: false,
    rejectsDuplicateSubmissions: false,
    requiresDefence: false,
    coach: { enabled: true, codeSignalsAfterFailedRuns: 0 },
    trapsBeforeAttempt: true,
  },
  hard: {
    layers: ["brief", "contract", "stub", "hints"],
    hints: { kind: "after_failed_runs", failedRuns: 1 },
    visibility: { publicNames: false, publicAssertions: false, hiddenCount: true, acceptanceRate: false },
    timed: false,
    requiresLearnerTests: false,
    confirmBeforeSubmit: false,
    adversarialAlwaysRuns: false,
    rejectsDuplicateSubmissions: false,
    requiresDefence: true,
    coach: { enabled: true, codeSignalsAfterFailedRuns: 1 },
    trapsBeforeAttempt: false,
  },
  extreme: {
    // The signature and its contract, and hints that cost a real attempt
    // first: two failed runs and a written approach. Still nothing about the
    // batteries, still timed, still one submit a day.
    layers: ["brief", "contract", "stub", "hints"],
    hints: { kind: "after_failed_runs_and_note", failedRuns: 2, noteChars: 200 },
    visibility: { publicNames: false, publicAssertions: false, hiddenCount: false, acceptanceRate: false },
    timed: true,
    requiresLearnerTests: true,
    confirmBeforeSubmit: true,
    adversarialAlwaysRuns: true,
    rejectsDuplicateSubmissions: true,
    requiresDefence: true,
    coach: { enabled: true, codeSignalsAfterFailedRuns: 2 },
    trapsBeforeAttempt: false,
  },
};

/**
 * A real screen: the brief, a blank editor, no hints, nothing about the tests.
 *
 * This is what Extreme meant before the 29 September 2026 amendment, kept
 * whole so the rehearsal still reproduces the room a learner is preparing for.
 * docs/00 section 7.4: a rehearsal runs its problems "under Extreme rules
 * regardless of their native difficulty: no hints, no test names, no
 * acceptance rates, one submit each".
 */
export const SCREEN_CONDITIONS: Tier = {
  layers: ["brief"],
  hints: { kind: "never" },
  visibility: { publicNames: false, publicAssertions: false, hiddenCount: false, acceptanceRate: false },
  timed: true,
  requiresLearnerTests: true,
  confirmBeforeSubmit: true,
  adversarialAlwaysRuns: true,
  rejectsDuplicateSubmissions: true,
  requiresDefence: true,
  coach: { enabled: false, codeSignalsAfterFailedRuns: 0 },
  trapsBeforeAttempt: false,
};

/**
 * Build one value per tier, in ladder order.
 *
 * Anything shaped like a grid over the ladder, the heatmap above all, wants
 * this rather than its own map keyed by difficulty. Keeping the keying here
 * means the ladder gaining a fifth tier changes one file.
 */
export function byTier<T>(build: (difficulty: Difficulty) => T): Record<Difficulty, T> {
  const out = {} as Record<Difficulty, T>;
  for (const difficulty of DIFFICULTIES) out[difficulty] = build(difficulty);
  return out;
}

/**
 * Where a tier sits on the ladder, 1 for Easy up to 4 for Extreme.
 *
 * For drawing a difficulty meter. It is a position, not a behaviour: anything
 * that wants to act differently by tier reads the tier itself.
 */
export function ladderPosition(difficulty: Difficulty): number {
  const index = DIFFICULTIES.indexOf(difficulty);
  if (index < 0) throw new Error(`no position on the ladder for difficulty ${difficulty}`);
  return index + 1;
}

/** The learner-facing label: Easy, Medium, Hard or Extreme, and nothing else. */
export function difficultyLabel(difficulty: Difficulty): string {
  return difficulty.charAt(0).toUpperCase() + difficulty.slice(1);
}

export function tierFor(difficulty: Difficulty): Tier {
  const tier = TIERS[difficulty];
  if (!tier) throw new Error(`no tier defined for difficulty ${difficulty}`);
  return tier;
}
