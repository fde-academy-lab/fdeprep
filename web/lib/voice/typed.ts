/**
 * A typed answer: the fallback for a learner whose microphone or connection
 * fails, or who cannot speak where they are. docs/07, as amended 1 October
 * 2026.
 *
 * Saved as a finished session marked typed, so the same judge scores it on the
 * same rubric and the same debrief shows it. It has no timings, so the score
 * leaves pace out and structure is beat coverage alone (lib/voice/score.ts).
 *
 * It spends the allowance a spoken answer in that mode spends, because it
 * costs the same two model calls. It records no audio, so it needs no
 * recording consent: the text is an answer, like a design answer, and faculty
 * see it the way they see those.
 */
import { inTransaction } from "../db/pool.ts";
import { consume, voiceScope } from "../policy/caps.ts";
import { wordCount } from "./persist.ts";
import type { VoiceMode } from "./start.ts";

export class TypedAnswerRefused extends Error {
  readonly status = 400;
}

/**
 * A fast speaker's rate. A typed answer may say no more than the question's
 * clock would let anyone say out loud, so typing buys time to think and not
 * length: the judge reads an answer the same size as a spoken one.
 */
export const TYPED_WORDS_PER_MINUTE = 180;

export function typedWordLimit(totalSeconds: number): number {
  return Math.ceil((totalSeconds / 60) * TYPED_WORDS_PER_MINUTE);
}

export async function submitTypedAnswer(input: {
  enrolmentId: number;
  cohortId: number;
  voiceQuestionId: number;
  mode: VoiceMode;
  text: string;
}): Promise<number> {
  const text = input.text.trim();
  if (!text) {
    throw new TypedAnswerRefused("Type your answer before you send it. Nothing was saved.");
  }
  // Pressure is an interviewer cutting in out loud, which a text box cannot
  // do, and it spends the scarce weekly allowance.
  if (input.mode === "pressure") {
    throw new TypedAnswerRefused(
      "Pressure needs a spoken answer, because the interviewer interrupts out loud. " +
        "Type a guided answer instead. Nothing was saved.");
  }
  // Interview mode is a conversation out loud: the follow-ups are spoken and
  // each reply is heard. docs/07 section 5a.
  if (input.mode === "interview") {
    throw new TypedAnswerRefused(
      "Interview mode needs a spoken answer, because the interviewer follows up out loud. " +
        "Type a guided answer instead. Nothing was saved.");
  }

  return inTransaction(async (client) => {
    const { rows: questions } = await client.query<{ total_seconds: number }>(
      "select total_seconds from voice_question where id = $1", [input.voiceQuestionId]);
    const question = questions[0];
    if (!question) throw new TypedAnswerRefused("That question does not exist. Nothing was saved.");

    const limit = typedWordLimit(question.total_seconds);
    const words = wordCount(text);
    if (words > limit) {
      throw new TypedAnswerRefused(
        `Your answer is ${words} words. This question's clock allows about ${limit} spoken ` +
          "words, so cut it to that and send it again. Nothing was saved.");
    }

    // The cap first, so a refused allowance leaves nothing behind.
    await consume(client, { enrolmentId: input.enrolmentId, scope: voiceScope(input.mode) });

    const { rows } = await client.query<{ id: string }>(
      `insert into voice_session
         (enrolment_id, voice_question_id, cohort_id, mode, input, finished_at, transcript,
          transcript_segments, spent_allowance)
       values ($1, $2, $3, $4, 'typed', now(), $5, '[]'::jsonb, true)
       returning id`,
      [input.enrolmentId, input.voiceQuestionId, input.cohortId, input.mode, text]);
    const sessionId = Number(rows[0]!.id);

    // One row per beat, as a spoken session has, so the judge's coverage has
    // somewhere to land and the debrief lists every beat. Nothing was
    // reached on a clock, because there was no clock.
    await client.query(
      `insert into voice_beat_result
         (voice_session_id, beat_key, covered, live_covered, reached_at_ms, spent_ms, pace_state)
       select $1, beat_key, false, false, null, 0, 'never_reached'
         from voice_beat where voice_question_id = $2 order by ordinal`,
      [sessionId, input.voiceQuestionId]);

    return sessionId;
  });
}
