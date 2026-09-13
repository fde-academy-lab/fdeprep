/**
 * The difficulty policy module.
 *
 * CLAUDE.md: no component reads `difficulty` directly, everything asks here.
 * Difficulty behaviour changes often and scattered checks drift out of step,
 * so every question about what a tier does is answered in this one file.
 *
 * The source is docs/00 section 3.2 and docs/01 screens S3 and S4.
 */
export type Difficulty = "easy" | "medium" | "hard" | "extreme";

export type HintPolicy =
  | { state: "free" }
  | { state: "after_failed_runs"; runs: number }
  | { state: "after_failed_runs_and_note"; runs: number; noteChars: number }
  | { state: "never" };

export interface Policy {
  /** Which scaffold layers render in the left pane. */
  showsContract: boolean;
  showsStub: boolean;
  showsSteps: boolean;
  hints: HintPolicy;
  /** Public test names are visible on every tier; assertions only on Easy. */
  showsPublicAssertions: boolean;
  showsHiddenCount: boolean;
  /** docs/01 S3: solve rate is hidden on Hard and Extreme rows. */
  showsSolveRate: boolean;
  /** docs/00: Extreme is timed and the learner writes their own tests first. */
  isTimed: boolean;
  requiresLearnerTests: boolean;
  confirmBeforeSubmit: boolean;
  adversarialAlwaysRuns: boolean;
}

const POLICIES: Record<Difficulty, Policy> = {
  easy: {
    showsContract: true, showsStub: true, showsSteps: true,
    hints: { state: "free" },
    showsPublicAssertions: true, showsHiddenCount: true, showsSolveRate: true,
    isTimed: false, requiresLearnerTests: false, confirmBeforeSubmit: false,
    adversarialAlwaysRuns: false,
  },
  medium: {
    showsContract: true, showsStub: true, showsSteps: false,
    hints: { state: "after_failed_runs", runs: 1 },
    showsPublicAssertions: false, showsHiddenCount: true, showsSolveRate: true,
    isTimed: false, requiresLearnerTests: false, confirmBeforeSubmit: false,
    adversarialAlwaysRuns: false,
  },
  hard: {
    showsContract: true, showsStub: false, showsSteps: false,
    hints: { state: "after_failed_runs_and_note", runs: 2, noteChars: 200 },
    showsPublicAssertions: false, showsHiddenCount: true, showsSolveRate: false,
    isTimed: false, requiresLearnerTests: false, confirmBeforeSubmit: false,
    adversarialAlwaysRuns: false,
  },
  extreme: {
    showsContract: false, showsStub: false, showsSteps: false,
    hints: { state: "never" },
    showsPublicAssertions: false, showsHiddenCount: false, showsSolveRate: false,
    isTimed: true, requiresLearnerTests: true, confirmBeforeSubmit: true,
    adversarialAlwaysRuns: true,
  },
};

export function policyFor(difficulty: Difficulty): Policy {
  const policy = POLICIES[difficulty];
  if (!policy) throw new Error(`no policy for difficulty ${difficulty}`);
  return policy;
}

/** The label the hint button carries, which states its own unlock condition. */
export function hintButtonLabel(difficulty: Difficulty, failedRuns: number,
                                noteChars: number): string {
  const { hints } = policyFor(difficulty);
  switch (hints.state) {
    case "free":
      return "Reveal a hint";
    case "never":
      return "No hints on Extreme";
    case "after_failed_runs":
      return failedRuns >= hints.runs
        ? "Reveal a hint"
        : `Unlocks after ${hints.runs} failed run`;
    case "after_failed_runs_and_note": {
      if (failedRuns < hints.runs) return `Unlocks after ${hints.runs} failed runs`;
      if (noteChars < hints.noteChars) {
        return `Unlocks after a note of ${hints.noteChars} characters`;
      }
      return "Reveal a hint";
    }
  }
}

/**
 * docs/02 section 4: body_sha256 exists so an identical resubmission can be
 * detected and, on Extreme, rejected without spending the daily allowance.
 * Which tiers that applies to is a policy question, so it is answered here.
 */
export function rejectsDuplicateSubmissions(difficulty: Difficulty): boolean {
  return policyFor(difficulty).confirmBeforeSubmit;
}

export function hintsAvailable(difficulty: Difficulty, failedRuns: number,
                               noteChars: number): boolean {
  return hintButtonLabel(difficulty, failedRuns, noteChars) === "Reveal a hint";
}
