/**
 * Loading a voice question, its beats and its follow-ups.
 *
 * Everything the cockpit renders comes from here, resolved on the server from
 * the session's own question id. The browser names nothing: it is handed a
 * question because its token says which session it is on.
 */
import { db } from "../db/pool.ts";
import type { Beat } from "./cues.ts";

export type FollowUp = {
  id: number;
  triggerAfterBeat: string;
  text: string;
  /** Null until Polly has synthesised it. The cockpit falls back to showing
   *  the line when there is no audio, because an interruption nobody can hear
   *  is worse than one that is read. */
  audioUrl: string | null;
  ordinal: number;
};

export type VoiceQuestion = {
  id: number;
  slug: string;
  title: string;
  track: string;
  totalSeconds: number;
  promptText: string;
  beats: Beat[];
  followUps: FollowUp[];
};

export class QuestionNotFound extends Error {
  readonly status = 404;
}

export async function loadQuestion(id: number): Promise<VoiceQuestion> {
  const pool = db();

  const { rows } = await pool.query<{
    id: string; slug: string; title: string; track: string;
    total_seconds: number; prompt_text: string;
  }>(
    `select id, slug, title, track, total_seconds, prompt_text
       from voice_question where id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) throw new QuestionNotFound(`No voice question ${id}.`);

  const beats = await pool.query<{
    beat_key: string; label: string; seconds: number; anchors: string[]; ordinal: number;
  }>(
    `select beat_key, label, seconds, anchors, ordinal
       from voice_beat where voice_question_id = $1 order by ordinal`,
    [id],
  );

  const followUps = await pool.query<{
    id: string; trigger_after_beat: string; text: string; audio_key: string | null;
    ordinal: number;
  }>(
    `select id, trigger_after_beat, text, audio_key, ordinal
       from voice_follow_up where voice_question_id = $1 order by ordinal`,
    [id],
  );

  return {
    id: Number(row.id),
    slug: row.slug,
    title: row.title,
    track: row.track,
    totalSeconds: row.total_seconds,
    promptText: row.prompt_text,
    beats: beats.rows.map((beat) => ({
      key: beat.beat_key,
      label: beat.label,
      seconds: beat.seconds,
      anchors: beat.anchors,
      ordinal: beat.ordinal,
    })),
    followUps: followUps.rows.map((followUp) => ({
      id: Number(followUp.id),
      triggerAfterBeat: followUp.trigger_after_beat,
      text: followUp.text,
      // The key is never handed to the browser. A signed URL is minted for
      // the one object this session needs, in lib/voice/tts.ts.
      audioUrl: followUp.audio_key ? `/api/voice/questions/${id}/follow-ups/${followUp.id}/audio` : null,
      ordinal: followUp.ordinal,
    })),
  };
}

/** docs/07 section 2: "four to six beats. Three is not a pathway, seven is a
 *  script." Checked on load rather than only at authoring time, because a
 *  question edited in the database is a question nobody validated. */
export function beatsAreAPathway(beats: Beat[]): boolean {
  return beats.length >= 4 && beats.length <= 6;
}

/**
 * The question a learner gets, by slug when they asked for one.
 *
 * Published questions only. The development fixture is unpublished and is the
 * last resort, for a database that has not had `npm run import:content` run
 * against it yet, which is every fresh checkout.
 *
 * Ordered by slug rather than by id so the same learner opening the screen
 * twice gets the same question, and an import that renumbers rows does not
 * silently change what everybody is answering.
 */
export async function publishedQuestionId(slug?: string): Promise<number | null> {
  const { rows } = await db().query<{ id: string }>(
    `select id from voice_question
      where is_published and ($1::text is null or slug = $1)
      order by slug limit 1`,
    [slug ?? null]);
  return rows[0] ? Number(rows[0].id) : null;
}

/** Every published question, for the picker. */
export async function publishedQuestions(): Promise<Array<{ id: number; slug: string; title: string }>> {
  const { rows } = await db().query<{ id: string; slug: string; title: string }>(
    "select id, slug, title from voice_question where is_published order by slug");
  return rows.map((r) => ({ id: Number(r.id), slug: r.slug, title: r.title }));
}
