/**
 * Everything the debrief screen renders, assembled once on the server.
 *
 * docs/07 section 6 draws five panels: the score line, the beats, the
 * territory not entered, the judge's sentence, and delivery marked not
 * scored. This returns exactly those and the replay timeline. The territory
 * is per beat since 30 September 2026: the words a strong answer used there that
 * this one did not, and the sentence it used them in (lib/voice/depth.ts).
 *
 * Delivery arrives here because this is the screen it is for. It arrives as
 * its own field on its own type, never folded into the score, and the test in
 * tests/fairness.test.ts checks that this module and the screen are the only
 * two places it reaches.
 */
import { db } from "../db/pool.ts";
import { STUCK_VOICE_AFTER_MINUTES } from "../admin/ops.ts";
import { RETENTION_DAYS } from "./audio.ts";
import type { PaceState } from "./cues.ts";
import { deliveryFor, type Delivery, type Segment } from "./delivery.ts";
import { depthByBeat, type BeatDepth } from "./depth.ts";
import {
  interviewerOnRecord, interviewerTitle, labelOf, type InterviewerLabel,
} from "./interviewers.ts";
import { loadQuestion, type VoiceQuestion } from "./question.ts";
import { MAX_JUDGE_ATTEMPTS } from "./score.ts";
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
  /** Typed answers have no clock, no pace, no delivery and no recording. */
  input: "spoken" | "typed";
  question: VoiceQuestion;
  /** Who asked, retired or not. Null for a session from before interviewers
   *  existed, which the page reads as no interviewer chosen. */
  interviewer: InterviewerLabel | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number;
  scored: boolean;
  /** Ended before it counted (docs/07 section 10): given back, never judged. */
  notCounted: boolean;
  /** The judge failed on every attempt, so the answer is unscored for good
   *  and its allowance was given back. */
  judgeGaveUp: boolean;
  /** Pace is null on a typed answer, which is scored without it. */
  score: { total: number; content: number; structure: number; pace: number | null } | null;
  beats: DebriefBeat[];
  /** The "TERRITORY NOT ENTERED" panel, per beat: what a strong answer named
   *  that this one did not, and the strong answer's own sentence.
   *  lib/voice/depth.ts says why it is this and not an evidence, number and
   *  trade-off check. */
  depth: BeatDepth[];
  judgeSummary: string;
  transcript: string;
  segments: Segment[];
  nudges: DebriefNudge[];
  /** Reported, never scored. docs/07 section 6. Null on a typed answer,
   *  which has no speech to report on. */
  delivery: Delivery | null;
  audio: { available: boolean; deletedAt: string | null; shared: boolean };
};

export async function loadDebrief(
  sessionId: number,
  enrolmentId: number,
): Promise<Debrief> {
  const pool = db();

  const { rows } = await pool.query<{
    id: string; mode: VoiceMode; voice_question_id: string; input: "spoken" | "typed";
    started_at: Date; finished_at: Date | null; scored_at: Date | null;
    transcript: string | null; transcript_segments: Segment[] | null;
    content_score: string | null; structure_score: string | null;
    pace_score: string | null; score: string | null;
    delivery: Delivery | null; judge_result: { summary?: string; skipped?: string } | null;
    audio_s3_key: string | null; audio_deleted_at: Date | null; shared: boolean;
    judge_attempts: number; interviewer_slug: string | null;
  }>(
    `select s.id, s.mode, s.voice_question_id, s.input, s.started_at, s.finished_at, s.scored_at,
            s.transcript, s.transcript_segments, s.content_score, s.structure_score,
            s.pace_score, s.score, s.delivery, s.judge_result, s.judge_attempts,
            s.audio_s3_key, s.audio_deleted_at, s.interviewer_slug,
            coalesce(sh.id is not null and sh.withdrawn_at is null, false) as shared
       from voice_session s
       left join voice_session_share sh on sh.voice_session_id = s.id
      where s.id = $1 and s.enrolment_id = $2`,
    [sessionId, enrolmentId],
  );
  const row = rows[0];
  if (!row) throw new DebriefNotFound("That session is not yours, or does not exist.");

  const question = await loadQuestion(Number(row.voice_question_id));
  const interviewer = await interviewerOnRecord(row.interviewer_slug);

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

  const strong = await pool.query<{ transcript: string }>(
    "select transcript from voice_exemplar where voice_question_id = $1 and band = 'strong'",
    [Number(row.voice_question_id)],
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

  const typed = row.input === "typed";
  const notCounted = row.judge_result?.skipped === "did_not_count";
  const scored = row.scored_at !== null && !notCounted;

  return {
    sessionId,
    mode: row.mode,
    input: row.input,
    question,
    interviewer: interviewer ? labelOf(interviewer) : null,
    startedAt: row.started_at.toISOString(),
    finishedAt: finishedAt ? finishedAt.toISOString() : null,
    durationMs: finishedAt ? finishedAt.getTime() - row.started_at.getTime() : 0,
    scored,
    notCounted,
    judgeGaveUp: row.finished_at !== null && row.scored_at === null &&
      row.judge_attempts >= MAX_JUDGE_ATTEMPTS,
    score: !scored ? null : {
      total: Number(row.score ?? 0),
      content: Number(row.content_score ?? 0),
      structure: Number(row.structure_score ?? 0),
      pace: typed || row.pace_score === null ? null : Number(row.pace_score),
    },
    beats,
    depth: depthByBeat(question.beats, row.transcript ?? "", strong.rows[0]?.transcript ?? null),
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
    delivery: typed ? null : row.delivery ?? deliveryFor(segments),
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
    id: string; mode: VoiceMode; input: "spoken" | "typed"; title: string; started_at: Date;
    finished_at: Date; score: string | null; scored_at: Date | null; not_counted: boolean;
    judge_attempts: number; audio_s3_key: string | null; audio_deleted_at: Date | null;
    interviewer_slug: string | null; interviewer_name: string | null; role_line: string | null;
  }>(
    `select s.id, s.mode, s.input, q.title, s.started_at, s.finished_at, s.score, s.scored_at,
            coalesce(s.judge_result ->> 'skipped' = 'did_not_count', false) as not_counted,
            s.judge_attempts, s.audio_s3_key, s.audio_deleted_at,
            s.interviewer_slug, i.name as interviewer_name, i.role_line
       from voice_session s join voice_question q on q.id = s.voice_question_id
       left join voice_interviewer i on i.slug = s.interviewer_slug
      where s.enrolment_id = $1 and s.finished_at is not null
      order by s.started_at desc limit 50`,
    [enrolmentId],
  );

  return rows.map((row) => ({
    id: Number(row.id),
    mode: row.mode,
    input: row.input,
    title: row.title,
    // Retired or not: a past answer keeps saying who asked.
    interviewer: row.interviewer_slug && row.interviewer_name && row.role_line
      ? { slug: row.interviewer_slug, name: row.interviewer_name, role: row.role_line,
          title: interviewerTitle(row.interviewer_slug, row.role_line) }
      : null,
    startedAt: row.started_at.toISOString(),
    finishedAt: row.finished_at.toISOString(),
    notCounted: row.not_counted,
    // The same reading as the debrief's: unscored for good, allowance given back.
    judgeGaveUp: row.scored_at === null && row.judge_attempts >= MAX_JUDGE_ATTEMPTS,
    score: row.scored_at === null || row.not_counted ? null : Number(row.score ?? 0),
    hasAudio: row.audio_s3_key !== null && row.audio_deleted_at === null,
    audioDeletedAt: row.audio_deleted_at ? row.audio_deleted_at.toISOString() : null,
  }));
}

export type PastSession = Awaited<ReturnType<typeof pastSessions>>[number];

/** What Past answers says about an answer's score. */
export type ScoreState = "scored" | "not_counted" | "scoring" | "late" | "gave_up";

/**
 * An answer still unscored after the wait Ops allows before listing it as
 * stuck is late, and the learner is told who to tell. One the judge gave up
 * on had its allowance given back, so the learner can answer again.
 */
export function scoreState(
  session: Pick<PastSession, "score" | "notCounted" | "judgeGaveUp" | "finishedAt">,
  now: Date = new Date(),
): ScoreState {
  if (session.notCounted) return "not_counted";
  if (session.score !== null) return "scored";
  if (session.judgeGaveUp) return "gave_up";
  const waited = now.getTime() - new Date(session.finishedAt).getTime();
  return waited > STUCK_VOICE_AFTER_MINUTES * 60_000 ? "late" : "scoring";
}

/** What Past answers says about an answer's recording. */
export type AudioState = "typed" | "kept" | "expired" | "deleted" | "none";

/**
 * A recording the scorer's sweep removed was kept for RETENTION_DAYS; one
 * removed sooner was deleted by the learner (docs/07 section 9). An answer
 * with no recording ever stored says so rather than claiming a deletion.
 */
export function audioState(
  session: Pick<PastSession, "input" | "hasAudio" | "audioDeletedAt" | "finishedAt">,
): AudioState {
  if (session.input === "typed") return "typed";
  if (session.hasAudio) return "kept";
  if (!session.audioDeletedAt) return "none";
  const kept = new Date(session.audioDeletedAt).getTime() - new Date(session.finishedAt).getTime();
  return kept >= RETENTION_DAYS * 86_400_000 ? "expired" : "deleted";
}
