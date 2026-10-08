/**
 * Scoring finished voice sessions.
 *
 * The same judge Lambda Phase 4 built, reached the same way the submission
 * worker reaches it. What is different is what drives it: a voice session is
 * not a submission, has no outbox row, no lease and no allowance to consume,
 * so putting it through the submission pipeline would mean adding a
 * discriminator to the most security-sensitive path in the repository to buy
 * nothing. This finds finished sessions that have no result yet.
 *
 * The trust boundary is unchanged. This worker has the database and no model
 * credential; the Lambda has Bedrock and no database. Two model calls per
 * session, both after the learner has stopped speaking.
 */
import { db, inTransaction } from "../db/pool.ts";
import { release, voiceScope } from "../policy/caps.ts";
import { invoke, type JudgeOptions } from "../queue/judge-worker.ts";
import { deliveryFor, type Segment } from "./delivery.ts";
import { loadQuestion } from "./question.ts";
import {
  MAX_JUDGE_ATTEMPTS, scoreTypedAnswer, scoreVoiceSession, type BeatOutcome,
} from "./score.ts";
import type { PaceState } from "./cues.ts";
import type { VoiceMode } from "./run.ts";
import { scoredRounds } from "./turns.ts";

export type ScoreOptions = JudgeOptions & {
  limit?: number;
  /** This session and no other. The seed scores the answer it just finished this way. */
  sessionId?: number;
};

type SessionRow = {
  id: string;
  voice_question_id: string;
  mode: VoiceMode;
  input: "spoken" | "typed";
  transcript: string | null;
  transcript_segments: Segment[] | null;
  started_at: Date;
  finished_at: Date;
  /** Interview mode: where the main answer ended. finished_at is the close
   *  of the whole interview, after its rounds. */
  answer_finished_at: Date | null;
};

export async function scoreVoiceOnce(options: ScoreOptions = {}): Promise<number> {
  const { rows } = await db().query<SessionRow>(
    `select id, voice_question_id, mode, input, transcript, transcript_segments, started_at,
            finished_at, answer_finished_at
       from voice_session
      where finished_at is not null and scored_at is null and judge_attempts < $2
        and ($3::bigint is null or id = $3)
      order by finished_at
      limit $1`,
    [options.limit ?? 5, MAX_JUDGE_ATTEMPTS, options.sessionId ?? null],
  );

  for (const row of rows) {
    try {
      await scoreSession(row, options);
    } catch (error) {
      // A session the scorer cannot read, a question that will not load or a
      // reply in a shape it does not expect, is that session's failed
      // attempt. It used to throw out of this loop and stop the scorer, so
      // every answer behind it waited until somebody restarted the process.
      console.warn(`voice session ${row.id} not scored: ${
        error instanceof Error ? error.message : String(error)}`);
      await giveBackAfterLastAttempt(Number(row.id));
    }
  }
  return rows.length;
}

async function scoreSession(row: SessionRow, options: ScoreOptions): Promise<void> {
  const sessionId = Number(row.id);
  await db().query(
    "update voice_session set judge_attempts = judge_attempts + 1 where id = $1",
    [sessionId],
  );

  const question = await loadQuestion(Number(row.voice_question_id));
  const rubric = await loadRubric(Number(row.voice_question_id));
  // docs/07 section 5a: in interview mode the rubric reads the main answer
  // and every scored round, each labelled with who asked. The beats are
  // judged on the main answer alone, which stays the event's transcript.
  // scoredRounds returns the why and stress rounds only, and every round
  // carries its kind, as the judge requires.
  const followUps = row.mode === "interview" ? await scoredRounds(sessionId) : [];

  let result: Record<string, unknown>;
  try {
    result = await invoke(
      {
        artefact_type: "voice",
        transcript: row.transcript ?? "",
        question: {
          beats: question.beats.map((beat) => ({ key: beat.key, label: beat.label })),
          rubric: rubric.criteria,
          exemplars: rubric.exemplars,
        },
        ...(followUps.length > 0 ? { follow_ups: followUps } : {}),
      },
      options,
    );
  } catch (error) {
    // A judge that throws, an endpoint answering 502 for example, is the same
    // failure as one that says so, and must not stop the loop scoring the
    // sessions behind this one.
    result = { status: "error", message: error instanceof Error ? error.message : String(error) };
  }

  if (result.status !== "ok") {
    // Left unscored on purpose. docs/03 section 8's reasoning carries over: a
    // model failure is the platform's problem, and a session scored on a
    // guess is worse than one scored late.
    console.warn(`voice session ${sessionId} not scored: ${String(result.message)}`);
    await giveBackAfterLastAttempt(sessionId);
    return;
  }

  await writeScore(sessionId, row, question.totalSeconds, result);
  console.log(`voice session ${sessionId} scored`);
}

/**
 * CLAUDE.md: an error verdict never consumes an allowance. A session the
 * judge has failed on for the last time gives its unit back, so a Bedrock
 * outage costs the learner nothing but the wait. The transcript stays, and
 * the debrief says scoring has not run.
 */
async function giveBackAfterLastAttempt(sessionId: number): Promise<void> {
  await inTransaction(async (client) => {
    const { rows } = await client.query<{ enrolment_id: string; mode: VoiceMode; started_at: Date }>(
      `update voice_session set spent_allowance = false
        where id = $1 and spent_allowance and scored_at is null and judge_attempts >= $2
        returning enrolment_id, mode, started_at`,
      [sessionId, MAX_JUDGE_ATTEMPTS],
    );
    const row = rows[0];
    if (!row) return;
    await release(client, {
      enrolmentId: Number(row.enrolment_id), scope: voiceScope(row.mode), at: row.started_at,
    });
  });
}

async function loadRubric(questionId: number) {
  const pool = db();
  const criteria = await pool.query<{
    criterion_key: string; label: string; weight: number; descriptor_md: string | null;
  }>(
    `select criterion_key, label, weight, descriptor_md
       from voice_rubric_criterion where voice_question_id = $1 order by ordinal`,
    [questionId],
  );
  const exemplars = await pool.query<{ band: string; score: number; transcript: string }>(
    `select band, score, transcript from voice_exemplar
      where voice_question_id = $1
      order by case band when 'strong' then 1 when 'adequate' then 2 else 3 end`,
    [questionId],
  );

  return {
    // Shaped for judge/rubric.py, which expects id, label, weight and an
    // optional descriptor.
    criteria: criteria.rows.map((row) => ({
      id: row.criterion_key,
      label: row.label,
      weight: row.weight,
      descriptor_md: row.descriptor_md,
    })),
    exemplars: exemplars.rows.map((row) => ({
      band: row.band,
      score: row.score,
      body_md: row.transcript,
    })),
  };
}

async function writeScore(
  sessionId: number,
  row: SessionRow,
  totalSeconds: number,
  result: Record<string, unknown>,
): Promise<void> {
  const judged = (result.beats as { beat_key: string; covered: boolean }[]) ?? [];
  const coverage = new Map(judged.map((beat) => [beat.beat_key, beat.covered]));

  await inTransaction(async (client) => {
    // The live pass is already stored. The judge's answer goes into the same
    // rows' `covered` column, which was false until now, so the debrief can
    // show both and the replay can show where they disagreed.
    const { rows: stored } = await client.query<{
      beat_key: string; reached_at_ms: number | null; spent_ms: number;
      pace_state: string; live_covered: boolean; seconds: number; ordinal: number;
    }>(
      `select r.beat_key, r.reached_at_ms, r.spent_ms, r.pace_state, r.live_covered,
              b.seconds, b.ordinal
         from voice_beat_result r
         join voice_session s on s.id = r.voice_session_id
         join voice_beat b on b.voice_question_id = s.voice_question_id
                          and b.beat_key = r.beat_key
        where r.voice_session_id = $1
        order by b.ordinal`,
      [sessionId],
    );

    for (const [key, covered] of coverage) {
      await client.query(
        "update voice_beat_result set covered = $3 where voice_session_id = $1 and beat_key = $2",
        [sessionId, key, covered],
      );
    }

    const beats: BeatOutcome[] = stored.map((beat) => ({
      beatKey: beat.beat_key,
      covered: coverage.get(beat.beat_key) ?? false,
      liveCovered: beat.live_covered,
      reachedAtMs: beat.reached_at_ms,
      spentMs: beat.spent_ms,
      paceState: beat.pace_state as PaceState,
      seconds: beat.seconds,
      ordinal: beat.ordinal,
    }));

    // The main answer's own clock: pace is about the answer, and an interview
    // closes only after its rounds.
    const durationMs = (row.answer_finished_at ?? row.finished_at).getTime() - row.started_at.getTime();
    const contentPoints = Number(result.content_points ?? 0);
    // A typed answer has no timings, so it is scored without pace rather
    // than handed a pace score computed from a clock that never ran.
    const score = row.input === "typed"
      ? scoreTypedAnswer({ contentPoints, beats })
      : scoreVoiceSession({ contentPoints, beats, durationMs, totalSeconds });

    // Delivery is computed here and written to its own column. It is not an
    // argument to either scorer and could not be: docs/07 section 6's
    // fairness rule keeps it out of the score, and the functions do not share
    // a parameter. A typed answer has no delivery to report.
    const delivery = row.input === "typed" ? null : deliveryFor(row.transcript_segments ?? []);

    await client.query(
      `update voice_session
          set content_score = $2, structure_score = $3, pace_score = $4, score = $5,
              delivery = $6, judge_result = $7, scored_at = now()
        where id = $1`,
      [
        sessionId,
        score.content.points,
        score.structure.points,
        score.pace === null ? null : score.pace.points,
        score.total,
        delivery === null ? null : JSON.stringify(delivery),
        JSON.stringify({
          summary: result.summary ?? "",
          criteria: result.criteria ?? [],
          beats: judged,
          modelCalls: result.model_calls ?? 0,
        }),
      ],
    );
  });
}
