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
import { invoke, type JudgeOptions } from "../queue/judge-worker.ts";
import { deliveryFor, type Segment } from "./delivery.ts";
import { loadQuestion } from "./question.ts";
import { scoreVoiceSession, type BeatOutcome } from "./score.ts";
import type { PaceState } from "./cues.ts";

/** A session the judge failed on this many times is left alone rather than
 *  retried forever. An operator can see it in the admin submissions view and
 *  the learner keeps the deterministic half of their score. */
export const MAX_JUDGE_ATTEMPTS = 3;

export type ScoreOptions = JudgeOptions & { limit?: number };

type SessionRow = {
  id: string;
  voice_question_id: string;
  transcript: string | null;
  transcript_segments: Segment[] | null;
  started_at: Date;
  finished_at: Date;
};

export async function scoreVoiceOnce(options: ScoreOptions = {}): Promise<number> {
  const { rows } = await db().query<SessionRow>(
    `select id, voice_question_id, transcript, transcript_segments, started_at, finished_at
       from voice_session
      where finished_at is not null and scored_at is null and judge_attempts < $2
      order by finished_at
      limit $1`,
    [options.limit ?? 5, MAX_JUDGE_ATTEMPTS],
  );

  for (const row of rows) await scoreSession(row, options);
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

  const result = await invoke(
    {
      artefact_type: "voice",
      transcript: row.transcript ?? "",
      question: {
        beats: question.beats.map((beat) => ({ key: beat.key, label: beat.label })),
        rubric: rubric.criteria,
        exemplars: rubric.exemplars,
      },
    },
    options,
  );

  if (result.status !== "ok") {
    // Left unscored on purpose. docs/03 section 8's reasoning carries over: a
    // model failure is the platform's problem, and a session scored on a
    // guess is worse than one scored late.
    console.warn(`voice session ${sessionId} not scored: ${String(result.message)}`);
    return;
  }

  await writeScore(sessionId, row, question.totalSeconds, result);
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

    const durationMs = row.finished_at.getTime() - row.started_at.getTime();
    const score = scoreVoiceSession({
      contentPoints: Number(result.content_points ?? 0),
      beats,
      durationMs,
      totalSeconds,
    });

    // Delivery is computed here and written to its own column. It is not an
    // argument to scoreVoiceSession and could not be: docs/07 section 6's
    // fairness rule keeps it out of the score, and the two functions do not
    // share a parameter.
    const delivery = deliveryFor(row.transcript_segments ?? []);

    await client.query(
      `update voice_session
          set content_score = $2, structure_score = $3, pace_score = $4, score = $5,
              delivery = $6, judge_result = $7, scored_at = now()
        where id = $1`,
      [
        sessionId,
        score.content.points,
        score.structure.points,
        score.pace.points,
        score.total,
        JSON.stringify(delivery),
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
