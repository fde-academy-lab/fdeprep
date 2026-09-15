/**
 * Scoring a spoken answer. docs/07 section 6.
 *
 *   Content     50   the rubric judge, over in judge/. Not here.
 *   Structure   30   deterministic: coverage, order, and reaching each beat
 *                    before its budget ran out
 *   Pace        20   deterministic: time to the first substantive claim, how
 *                    many beats overran, and whether the answer closed inside
 *                    the clock
 *   Delivery     0   reported, never scored
 *
 * ## The fairness rule
 *
 * This is the module where it would be easiest to break, so it is built so
 * that breaking it takes an edit rather than an oversight. `deliveryFor` is a
 * separate function returning a separate type, and `scoreVoiceSession` never
 * calls it and cannot reach it. There is no path from a filler count to a
 * number in the score, because the two never meet.
 *
 * docs/07 section 6 gives the reason and it is not a preference: most learners
 * here speak English as a second or third language, and scoring fluency,
 * accent, pace against a native-speaker band or filler rate would tell a
 * strong engineer they are weak. Report the numbers, because a learner who
 * wants to work on filler words deserves the count. Keep them out of the
 * score, out of the heatmap, and out of anything a placement conversation
 * reads.
 */
import type { PaceState } from "./cues.ts";

export const CONTENT_WEIGHT = 50;
export const STRUCTURE_WEIGHT = 30;
export const PACE_WEIGHT = 20;

/**
 * Sub-weights inside structure and pace.
 *
 * docs/07 section 6 names the three ingredients of each axis and not their
 * split, so these are this build's own. Coverage carries most of structure
 * because reaching a beat at all is the thing an interviewer notices; order
 * and budget are how well it was done. Inside pace the three are even,
 * because none of them is obviously the one that matters.
 */
export const STRUCTURE_PARTS = { coverage: 18, order: 6, withinBudget: 6 };
export const PACE_PARTS = { firstClaim: 8, overruns: 6, closed: 6 };

/** A first substantive claim inside this is full marks. It is the first
 *  beat's own budget in the worked example, and a learner who has said
 *  something that lands inside their first beat has started well. */
export const FIRST_CLAIM_TARGET_MS = 30_000;

/** Past this, the opening has cost the answer whatever it was going to cost.
 *  Marks fall linearly between the two. */
export const FIRST_CLAIM_FLOOR_MS = 90_000;

export type BeatOutcome = {
  beatKey: string;
  /** The judge's answer, which is what the score uses. docs/07 section 7. */
  covered: boolean;
  /** What the cockpit lit. Shown in the debrief, never scored. */
  liveCovered: boolean;
  reachedAtMs: number | null;
  spentMs: number;
  paceState: PaceState;
  /** The authored budget for this beat, in seconds. */
  seconds: number;
  ordinal: number;
};

export type StructureScore = {
  points: number;
  outOf: number;
  covered: number;
  total: number;
  inOrder: boolean;
  withinBudget: number;
};

export type PaceScore = {
  points: number;
  outOf: number;
  firstClaimMs: number | null;
  overrunBeats: number;
  closedInsideClock: boolean;
};

export type VoiceScore = {
  content: { points: number; outOf: number };
  structure: StructureScore;
  pace: PaceScore;
  total: number;
};

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Structure. Coverage, order, and reaching each beat before its budget ran
 * out.
 *
 * Order means the beats that were covered were covered in the authored
 * sequence. An answer that reached b1, b2 and b4 is in order; one that reached
 * b3 before b1 is not. A beat never reached cannot be out of order, because it
 * is not anywhere.
 */
export function structureFor(beats: BeatOutcome[]): StructureScore {
  const ordered = [...beats].sort((a, b) => a.ordinal - b.ordinal);
  const total = ordered.length;
  if (total === 0) {
    return { points: 0, outOf: STRUCTURE_WEIGHT, covered: 0, total: 0, inOrder: true, withinBudget: 0 };
  }

  const covered = ordered.filter((beat) => beat.covered);
  const coveredPoints = (covered.length / total) * STRUCTURE_PARTS.coverage;

  const reachedTimes = covered
    .filter((beat) => beat.reachedAtMs !== null)
    .map((beat) => beat.reachedAtMs!);
  const inOrder = reachedTimes.every(
    (at, index) => index === 0 || at >= reachedTimes[index - 1]!,
  );
  // An answer that covered nothing earns nothing for order. An empty sequence
  // is trivially in order, and paying for that would give a learner who said
  // none of it six of the thirty structure points for saying none of it in the
  // right sequence.
  const orderPoints = covered.length > 0 && inOrder ? STRUCTURE_PARTS.order : 0;

  // Within budget: the beat was covered and did not overrun its own seconds.
  // A stretched beat still counts, because 130 percent of a thirty second
  // budget is nine seconds of slack and docs/07 reserves OVERRUN for the case
  // worth marking down.
  const withinBudget = covered.filter((beat) => beat.paceState !== "overrun").length;
  const budgetPoints =
    covered.length === 0 ? 0 : (withinBudget / covered.length) * STRUCTURE_PARTS.withinBudget;

  return {
    points: round(coveredPoints + orderPoints + budgetPoints),
    outOf: STRUCTURE_WEIGHT,
    covered: covered.length,
    total,
    inOrder,
    withinBudget,
  };
}

/**
 * Pace. Time to the first substantive claim, how many beats overran, and
 * whether the answer closed inside the clock.
 *
 * "Substantive claim" is the first beat the judge says was covered, taken at
 * the moment the cockpit reached it. That is the earliest defensible marker:
 * the first word spoken is not a claim, and the first beat covered is.
 */
export function paceFor(
  beats: BeatOutcome[],
  answer: { durationMs: number; totalSeconds: number },
): PaceScore {
  const covered = beats.filter((beat) => beat.covered && beat.reachedAtMs !== null);
  const firstClaimMs = covered.length === 0
    ? null
    : Math.min(...covered.map((beat) => beat.reachedAtMs!));

  let firstClaimPoints = 0;
  if (firstClaimMs !== null) {
    if (firstClaimMs <= FIRST_CLAIM_TARGET_MS) firstClaimPoints = PACE_PARTS.firstClaim;
    else if (firstClaimMs < FIRST_CLAIM_FLOOR_MS) {
      const span = FIRST_CLAIM_FLOOR_MS - FIRST_CLAIM_TARGET_MS;
      firstClaimPoints =
        PACE_PARTS.firstClaim * (1 - (firstClaimMs - FIRST_CLAIM_TARGET_MS) / span);
    }
  }

  const overrunBeats = beats.filter((beat) => beat.paceState === "overrun").length;
  const overrunPoints =
    beats.length === 0
      ? 0
      : PACE_PARTS.overruns * Math.max(0, 1 - overrunBeats / beats.length);

  // Closed inside the clock means the learner stopped rather than being
  // stopped. An answer cut off at the ceiling did not close.
  const closedInsideClock = answer.durationMs < answer.totalSeconds * 1000;

  return {
    points: round(firstClaimPoints + overrunPoints + (closedInsideClock ? PACE_PARTS.closed : 0)),
    outOf: PACE_WEIGHT,
    firstClaimMs,
    overrunBeats,
    closedInsideClock,
  };
}

/**
 * The whole score.
 *
 * Takes the judge's content points and the beat outcomes, and nothing else.
 * It has no parameter that could carry a delivery metric, which is the point:
 * the fairness rule is a type signature here rather than a comment.
 */
export function scoreVoiceSession(input: {
  contentPoints: number;
  beats: BeatOutcome[];
  durationMs: number;
  totalSeconds: number;
}): VoiceScore {
  const content = Math.max(0, Math.min(CONTENT_WEIGHT, input.contentPoints));
  const structure = structureFor(input.beats);
  const pace = paceFor(input.beats, {
    durationMs: input.durationMs,
    totalSeconds: input.totalSeconds,
  });

  return {
    content: { points: round(content), outOf: CONTENT_WEIGHT },
    structure,
    pace,
    total: round(content + structure.points + pace.points),
  };
}
