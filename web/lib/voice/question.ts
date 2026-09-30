/**
 * Loading a voice question, its beats and its follow-ups.
 *
 * Everything the cockpit renders comes from here, resolved on the server from
 * the session's own question id. The browser names nothing: it is handed a
 * question because its token says which session it is on.
 */
import { db } from "../db/pool.ts";
import type { Difficulty } from "../policy/tiers.ts";
import type { Beat } from "./cues.ts";
import { ttsConfig } from "./tts.ts";

export type FollowUp = {
  id: number;
  triggerAfterBeat: string;
  text: string;
  /** Set whenever speech is configured, before anything has been synthesised:
   *  the address synthesises the line on its first request and caches it.
   *  Null only where no bucket is configured, and then the cockpit shows the
   *  line, because an interruption nobody can hear is worse than one that is
   *  read. */
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
       from voice_follow_up where voice_question_id = $1 and retired_at is null
      order by ordinal`,
    [id],
  );
  // Asked once rather than per follow-up. No bucket means no synthesis, and a
  // path that can only answer 404 is worse than the written line.
  const speaks = ttsConfig() !== null;

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
      // The key is never handed to the browser. The path is on this
      // application, which streams the object and synthesises it first when
      // it has never been made, in lib/voice/tts.ts. Keying the path on the
      // stored key instead left it null until something synthesised the line,
      // and nothing did, so no follow-up was ever heard.
      audioUrl: speaks ? `/api/voice/questions/${id}/follow-ups/${followUp.id}/audio` : null,
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
 * The published question a slug names, or QuestionNotFound.
 *
 * Refused rather than swapped for another. The session route used to record
 * every graded answer against the docs/07 fixture whatever the learner had on
 * screen, so the judge scored the fixture's beats and the history named the
 * wrong question. A slug that names nothing is a stale link, and the learner
 * is better served by the picker than by an answer filed under a question
 * they never saw.
 */
export async function resolvePublishedQuestion(slug: string): Promise<number> {
  const { rows } = await db().query<{ id: string }>(
    "select id from voice_question where is_published and slug = $1", [slug]);
  if (!rows[0]) throw new QuestionNotFound(`No published voice question "${slug}".`);
  return Number(rows[0].id);
}

export type PublishedQuestion = {
  id: number;
  slug: string;
  title: string;
  track: string;
  difficulty: Difficulty;
  totalSeconds: number;
  followUps: number;
};

/**
 * The picker's track order: docs/07 section 11's table, which runs from
 * mechanism questions to the client conversations it says matter most. A
 * track outside it sorts last rather than disappearing.
 */
export const VOICE_TRACK_ORDER = [
  "agent-loop", "tool-schema-design", "evaluation-design", "system-design", "client-communication",
] as const;

/**
 * Every published question, for the picker, by track in that order and then
 * by slug.
 *
 * Never by id, so an import that renumbers rows does not reorder the list,
 * and Next question walks the same sequence every time. The development
 * fixture and the transport check are unpublished, so neither appears.
 */
export async function publishedQuestions(): Promise<PublishedQuestion[]> {
  const { rows } = await db().query<{
    id: string; slug: string; title: string; track: string; difficulty: Difficulty;
    total_seconds: number; follow_ups: string;
  }>(
    `select q.id, q.slug, q.title, q.track, q.difficulty, q.total_seconds,
            (select count(*) from voice_follow_up f
              where f.voice_question_id = q.id and f.retired_at is null) as follow_ups
       from voice_question q
      where q.is_published
      order by array_position($1::text[], q.track) nulls last, q.slug`,
    [VOICE_TRACK_ORDER]);
  return rows.map((r) => ({
    id: Number(r.id), slug: r.slug, title: r.title, track: r.track, difficulty: r.difficulty,
    totalSeconds: r.total_seconds, followUps: Number(r.follow_ups),
  }));
}

/**
 * The slug after this one in the picker's order, wrapping at the end, or null
 * when nothing is published. A slug that is no longer published starts the
 * list again rather than failing, since Next question should always go
 * somewhere.
 */
export async function nextQuestionSlug(slug: string): Promise<string | null> {
  const slugs = (await publishedQuestions()).map((q) => q.slug);
  if (slugs.length === 0) return null;
  const at = slugs.indexOf(slug);
  return slugs[(at + 1) % slugs.length]!;
}
