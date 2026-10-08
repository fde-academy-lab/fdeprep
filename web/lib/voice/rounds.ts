/**
 * The rounds of a forward deployed engineer's interview loop, one per voice
 * question. docs/07 section 2, as amended 9 October 2026.
 *
 * A closed list, because the picker and the lobby name the round a question
 * comes from and a learner reads it as a fact about the loop they will face.
 * The validator refuses any other value, so a typo fails CI rather than
 * showing up in the lobby as a round nobody runs.
 *
 * Browser-safe: no imports.
 */
export const ROUNDS = [
  "hiring-manager-screen",
  "technical-deep-dive",
  "system-design",
  "client-role-play",
  "decomposition-case",
  "judgement-call",
] as const;

export type Round = (typeof ROUNDS)[number];

/** What the picker and the lobby call each round. */
export const ROUND_NAMES: Readonly<Record<Round, string>> = {
  "hiring-manager-screen": "Hiring manager screen",
  "technical-deep-dive": "Technical deep dive",
  "system-design": "System design",
  "client-role-play": "Client role-play",
  "decomposition-case": "Decomposition case",
  "judgement-call": "Judgement call",
};

/** One line on what happens in each round, for the lobby. */
export const ROUND_LINES: Readonly<Record<Round, string>> = {
  "hiring-manager-screen": "The first thirty-minute screen: one question, and how you think about it.",
  "technical-deep-dive": "Mechanism and failure modes, with an engineer who has built it.",
  "system-design": "A spoken architecture walkthrough.",
  "client-role-play": "The interviewer plays the sponsor and stays in character.",
  "decomposition-case": "A brownfield case, cut into steps.",
  "judgement-call": "A decision made with incomplete evidence.",
};

export function isRound(value: unknown): value is Round {
  return typeof value === "string" && (ROUNDS as readonly string[]).includes(value);
}

/** The round's name, or the raw value for a row written before the list existed. */
export function roundName(value: string | null | undefined): string | null {
  if (!value) return null;
  return isRound(value) ? ROUND_NAMES[value] : value.replace(/-/g, " ");
}
