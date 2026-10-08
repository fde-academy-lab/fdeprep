/**
 * What difficulty decides on the Voice Screen. CLAUDE.md: no component reads
 * difficulty directly, everything asks the policy module, and the
 * no-direct-difficulty lint rule holds every file outside lib/policy to it.
 *
 * One decision so far: how many follow-up rounds an interview session runs
 * when the question does not say. docs/07 section 5a.
 *
 * Easy 2, Medium 3, Hard 4, Extreme 5. The ladder of why has five levels,
 * specify, evidence, mechanism, alternative and limit, and a hard question
 * should be able to climb the whole of it, while an easy one stops before the
 * rounds turn into a cross-examination. A question that needs another number
 * sets interview_rounds in its YAML, from 1 to 5. The number is resolved when
 * the session opens and written on the session row, so a content change never
 * changes a session that is running.
 */
import type { Difficulty } from "./tiers.ts";

const ROUNDS_BY_DIFFICULTY: Readonly<Record<Difficulty, number>> = {
  easy: 2,
  medium: 3,
  hard: 4,
  extreme: 5,
};

/** The most rounds any interview session runs. */
export const MAX_INTERVIEW_ROUNDS = 5;

export function defaultInterviewRounds(difficulty: Difficulty): number {
  return ROUNDS_BY_DIFFICULTY[difficulty] ?? ROUNDS_BY_DIFFICULTY.medium;
}

/** The cap a session runs with: the question's own when it set one inside
 *  1 to 5, else the default for its difficulty. */
export function interviewRoundsFor(question: {
  difficulty: Difficulty; interviewRounds: number | null;
}): number {
  const authored = question.interviewRounds;
  if (authored !== null && Number.isInteger(authored) && authored >= 1 &&
      authored <= MAX_INTERVIEW_ROUNDS) {
    return authored;
  }
  return defaultInterviewRounds(question.difficulty);
}
