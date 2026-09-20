/**
 * Bands, and what each one is worth. docs/10 section 8.
 *
 * P2 and P3 produce bands rather than points. A model asked for a number
 * invents precision it does not have: two runs on the same answer return 71 and
 * 78 while agreeing completely about what the answer is. Bands are stable
 * across runs, they are what an interviewer actually decides, and they turn
 * into a score once, here, rather than three times in three places.
 */

export type Band = "strong" | "adequate" | "weak" | "off_question";

/** Descending, so index distance is band distance. */
export const BANDS: readonly Band[] = ["strong", "adequate", "weak", "off_question"];

export const BAND_MEANING: Readonly<Record<Band, string>> = {
  strong: "The answer would pass the round.",
  adequate: "The answer would survive the round and invite a follow-up.",
  weak: "The answer would not pass.",
  off_question: "The answer addresses something else.",
};

/**
 * What each band is worth, anchored to the scores the content actually carries
 * rather than to numbers somebody liked.
 *
 * Measured across the 60 graded exemplars in problems/ and voice-questions/ on
 * 20 September 2026: strong runs 88 to 92, adequate 60 to 66, weak 26 to 31.
 * These are the medians of those three groups. `off_question` has no authored
 * examples, so 10 is a judgement: below anything a person has been willing to
 * call weak.
 *
 * Re-derive with scripts/band_anchors.py when the content changes.
 */
const SCORE: Readonly<Record<Band, number>> = {
  strong: 90,
  adequate: 63,
  weak: 29,
  off_question: 10,
};

export function bandScore(band: Band): number {
  return SCORE[band];
}

/**
 * A judge's rubric score turned into a band.
 *
 * The boundaries are the midpoints of the gaps between the authored groups:
 * 66 to 88 leaves 77, and 31 to 60 leaves 45. Those gaps are wide, which is
 * what makes the mapping stable: an answer has to move 20 points before it
 * changes band, and a judge that disagrees with itself by a few points does
 * not flip the result.
 */
export function bandForScore(score: number): Band {
  if (score >= 77) return "strong";
  if (score >= 45) return "adequate";
  if (score >= 20) return "weak";
  return "off_question";
}

/** How far apart two bands are, in steps. Two or more is a disagreement. */
export function bandDistance(a: Band, b: Band): number {
  return Math.abs(BANDS.indexOf(a) - BANDS.indexOf(b));
}

/** The more cautious of two bands. Used when judges differ. */
export function lowerBand(a: Band, b: Band): Band {
  return BANDS.indexOf(a) > BANDS.indexOf(b) ? a : b;
}

/** Two or more steps apart is worth telling a faculty member about. */
export const DISAGREEMENT_STEPS = 2;
