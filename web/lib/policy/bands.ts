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

const SCORE: Readonly<Record<Band, number>> = {
  strong: 90,
  adequate: 65,
  weak: 35,
  off_question: 5,
};

export function bandScore(band: Band): number {
  return SCORE[band];
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
