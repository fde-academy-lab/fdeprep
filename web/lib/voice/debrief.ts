/**
 * Everything the debrief screen renders, assembled once on the server.
 *
 * docs/07 section 6 draws five panels: the score line, the beats, the
 * territory not entered, the judge's sentence, and delivery marked not
 * scored. This returns exactly those and the replay timeline.
 *
 * Delivery arrives here because this is the screen it is for. It arrives as
 * its own field on its own type, never folded into the score, and the test in
 * tests/fairness.test.ts checks that this module and the screen are the only
 * two places it reaches.
 */
import { db } from "../db/pool.ts";
import type { PaceState } from "./cues.ts";
import { deliveryFor, type Delivery, type Segment } from "./delivery.ts";
import { loadQuestion, type VoiceQuestion } from "./question.ts";
import type { VoiceMode } from "./run.ts";

export class DebriefNotFound extends Error {
  readonly status = 404;
}

export type DebriefBeat = {
  key: string;
  label: string;
  /** The judge's answer. This is what the score used. */
  covered: boolean;
  /** What the cockpit lit while the learner spoke. The two are allowed to
   *  disagree and docs/07 section 7 says the disagreement is instructive. */
  liveCovered: boolean;
  reachedAtMs: number | null;
  spentMs: number;
  paceState: PaceState;
};

export type DebriefNudge = { atMs: number; kind: string; line: string; wasShown: boolean };

export type Debrief = {
  sessionId: number;
  mode: VoiceMode;
  question: VoiceQuestion;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number;
  scored: boolean;
  score: { total: number; content: number; structure: number; pace: number } | null;
  beats: DebriefBeat[];
  /** Anchors of beats the judge says were not covered. The "TERRITORY NOT
   *  ENTERED" panel: what the answer never went near. */
  territoryNotEntered: string[];
  judgeSummary: string;
  transcript: string;
  segments: Segment[];
  nudges: DebriefNudge[];
  /** Reported, never scored. docs/07 section 6. */
  delivery: Delivery;
  audio: { available: boolean; deletedAt: string | null; shared: boolean };
};

export async function loadDebrief(
  sessionId: number,
  enrolmentId: number,
): Promise<Debrief> {
  const pool = db();

  const { rows } = await pool.query<{
    id: string; mode: VoiceMode; voice_question_id: string;
    started_at: Date; finished_at: Date | null; scored_at: Date | null;
    transcript: string | null; transcript_segments: Segment[] | null;
    content_score: string | null; structure_score: string | null;
    pace_score: string | null; score: string | null;
    delivery: Delivery | null; judge_result: { summary?: string } | null;
    audio_s3_key: string | null; audio_deleted_at: Date | null; shared: boolean;
  }>(
    `select s.id, s.mode, s.voice_question_id, s.started_at, s.finished_at, s.scored_at,
            s.transcript, s.transcript_segments, s.content_score, s.structure_score,
            s.pace_score, s.score, s.delivery, s.judge_result,
            s.audio_s3_key, s.audio_deleted_at,
            coalesce(sh.id is not null and sh.withdrawn_at is null, false) as shared
       from voice_session s
       left join voice_session_share sh on sh.voice_session_id = s.id
      where s.id = $1 and s.enrolment_id = $2`,
    [sessionId, enrolmentId],
  );
  const row = rows[0];
  if (!row) throw new DebriefNotFound("That session is not yours, or does not exist.");

  const question = await loadQuestion(Number(row.voice_question_id));

  const beatRows = await pool.query<{
    beat_key: string; covered: boolean; live_covered: boolean;
    reached_at_ms: number | null; spent_ms: number; pace_state: string;
  }>(
    `select r.beat_key, r.covered, r.live_covered, r.reached_at_ms, r.spent_ms, r.pace_state
       from voice_beat_result r
       join voice_beat b on b.voice_question_id = $2 and b.beat_key = r.beat_key
      where r.voice_session_id = $1
      order by b.ordinal`,
    [sessionId, Number(row.voice_question_id)],
  );

  const nudgeRows = await pool.query<{
    at_ms: number; kind: string; line: string; was_shown: boolean;
  }>(
    "select at_ms, kind, line, was_shown from voice_nudge where voice_session_id = $1 order by at_ms",
    [sessionId],
  );

  const labels = new Map(question.beats.map((beat) => [beat.key, beat]));
  const beats: DebriefBeat[] = beatRows.rows.map((beat) => ({
    key: beat.beat_key,
    label: labels.get(beat.beat_key)?.label ?? beat.beat_key,
    covered: beat.covered,
    liveCovered: beat.live_covered,
    reachedAtMs: beat.reached_at_ms,
    spentMs: beat.spent_ms,
    paceState: beat.pace_state as PaceState,
  }));

  const segments = row.transcript_segments ?? [];
  const finishedAt = row.finished_at;

  return {
    sessionId,
    mode: row.mode,
    question,
    startedAt: row.started_at.toISOString(),
    finishedAt: finishedAt ? finishedAt.toISOString() : null,
    durationMs: finishedAt ? finishedAt.getTime() - row.started_at.getTime() : 0,
    scored: row.scored_at !== null,
    score: row.scored_at === null ? null : {
      total: Number(row.score ?? 0),
      content: Number(row.content_score ?? 0),
      structure: Number(row.structure_score ?? 0),
      pace: Number(row.pace_score ?? 0),
    },
    beats,
    territoryNotEntered: beats
      .filter((beat) => !beat.covered)
      .flatMap((beat) => labels.get(beat.key)?.anchors ?? []),
    judgeSummary: row.judge_result?.summary ?? "",
    transcript: row.transcript ?? "",
    segments,
    nudges: nudgeRows.rows.map((nudge) => ({
      atMs: nudge.at_ms,
      kind: nudge.kind,
      line: nudge.line,
      wasShown: nudge.was_shown,
    })),
    // Recomputed rather than read back, so the debrief shows the same numbers
    // whether or not the judge has run. It is reported either way.
    delivery: row.delivery ?? deliveryFor(segments),
    audio: {
      available: row.audio_s3_key !== null && row.audio_deleted_at === null,
      deletedAt: row.audio_deleted_at ? row.audio_deleted_at.toISOString() : null,
      shared: row.shared,
    },
  };
}

/** The learner's own past sessions, newest first. */
export async function pastSessions(enrolmentId: number) {
  const { rows } = await db().query<{
    id: string; mode: VoiceMode; title: string; started_at: Date;
    score: string | null; scored_at: Date | null;
    audio_s3_key: string | null; audio_deleted_at: Date | null;
  }>(
    `select s.id, s.mode, q.title, s.started_at, s.score, s.scored_at,
            s.audio_s3_key, s.audio_deleted_at
       from voice_session s join voice_question q on q.id = s.voice_question_id
      where s.enrolment_id = $1 and s.finished_at is not null
      order by s.started_at desc limit 50`,
    [enrolmentId],
  );

  return rows.map((row) => ({
    id: Number(row.id),
    mode: row.mode,
    title: row.title,
    startedAt: row.started_at.toISOString(),
    score: row.scored_at === null ? null : Number(row.score ?? 0),
    hasAudio: row.audio_s3_key !== null && row.audio_deleted_at === null,
  }));
}
