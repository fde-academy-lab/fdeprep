/**
 * A voice question from YAML into the database.
 *
 * The counterpart of lib/problems/import.ts, which did not exist: the twelve
 * questions in voice-questions/ were authored, validated in CI and never
 * loaded, so the Voice Screen could only serve the docs/07 fixture.
 *
 * Validated before anything is written, using the same gate CI runs, because a
 * question whose rubric sums to 94 fails in front of a learner who is already
 * speaking and a spoken answer cannot be recovered.
 *
 * Idempotent on the slug. An operator reruns this after every content change,
 * so a second run updates in place and a beat the author deleted is deleted
 * here too. Follow-ups are the exception, below: a pressure session's record
 * points at them, so they are updated in place and retired, never deleted.
 */
import type { PoolClient } from "pg";
import { inTransaction } from "../db/pool.ts";
import { validateVoiceYaml } from "./validate-question.ts";

export class VoiceImportRejected extends Error {}

interface Beat {
  id: string;
  label: string;
  seconds: number;
  anchors: string[];
}

interface Question {
  slug: string;
  title: string;
  track: string;
  difficulty: string;
  total_seconds: number;
  prompt_text: string;
  // docs/07 section 2, amended 9 October 2026. The validator requires all but
  // interview_rounds, which is optional and defers to the policy default.
  round: string;
  tests: string;
  interviewers: string[];
  builds_on: string[];
  framework: Record<string, string>;
  tips: string[];
  interview_rounds?: number;
  beats: Beat[];
  follow_ups?: Array<{ trigger_after_beat: string; text: string }>;
  rubric?: Array<{ criterion_key: string; label: string; weight: number; descriptor_md?: string }>;
  exemplars?: Array<{ band: string; score: number; transcript: string }>;
}

export async function importVoiceQuestion(source: string, file: string): Promise<number> {
  const report = validateVoiceYaml(source, file);
  if (!report.ok) {
    const first = report.errors[0]!;
    throw new VoiceImportRejected(
      `${file}:${first.line} ${first.rule}: ${first.message}` +
      (report.errors.length > 1 ? ` (and ${report.errors.length - 1} more)` : ""));
  }

  // parseDocument in the validator already proved this parses; re-reading it
  // as plain YAML keeps this module free of the validator's node types.
  const { parse } = await import("yaml");
  const q = parse(source) as Question;

  return await inTransaction(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `insert into voice_question
         (slug, title, track, difficulty, total_seconds, prompt_text, source_yaml, is_published,
          round, tests, interviewers, builds_on, framework, tips, interview_rounds)
       values ($1, $2, $3, $4, $5, $6, $7, true, $8, $9, $10, $11, $12, $13, $14)
       on conflict (slug) do update
         set title = excluded.title, track = excluded.track,
             difficulty = excluded.difficulty, total_seconds = excluded.total_seconds,
             prompt_text = excluded.prompt_text, source_yaml = excluded.source_yaml,
             is_published = true, round = excluded.round, tests = excluded.tests,
             interviewers = excluded.interviewers, builds_on = excluded.builds_on,
             framework = excluded.framework, tips = excluded.tips,
             interview_rounds = excluded.interview_rounds
       returning id`,
      [q.slug, q.title, q.track, q.difficulty, q.total_seconds, q.prompt_text.trim(), source,
       q.round, q.tests.trim(), q.interviewers, q.builds_on, JSON.stringify(q.framework),
       q.tips.map((tip) => tip.trim()), q.interview_rounds ?? null]);
    const id = Number(rows[0]!.id);

    // Delete then insert, rather than upsert and leave the rest. A beat the
    // author removed has to leave the database too, or the cockpit renders a
    // segment nothing will ever cue. Nothing holds a foreign key to these
    // three: a beat result names its beat by key.
    for (const table of ["voice_beat", "voice_rubric_criterion", "voice_exemplar"]) {
      await client.query(`delete from ${table} where voice_question_id = $1`, [id]);
    }

    for (const [index, beat] of q.beats.entries()) {
      await client.query(
        `insert into voice_beat (voice_question_id, beat_key, label, seconds, anchors, ordinal)
         values ($1, $2, $3, $4, $5, $6)`,
        [id, beat.id, beat.label, beat.seconds, beat.anchors, index + 1]);
    }

    for (const [index, c] of (q.rubric ?? []).entries()) {
      await client.query(
        `insert into voice_rubric_criterion
           (voice_question_id, criterion_key, label, weight, descriptor_md, ordinal)
         values ($1, $2, $3, $4, $5, $6)`,
        [id, c.criterion_key, c.label, c.weight, c.descriptor_md ?? null, index + 1]);
    }

    await syncFollowUps(client, id, q.follow_ups ?? []);

    for (const e of q.exemplars ?? []) {
      await client.query(
        `insert into voice_exemplar (voice_question_id, band, score, transcript)
         values ($1, $2, $3, $4)`,
        [id, e.band, e.score, e.transcript.trim()]);
    }

    return id;
  });
}

/**
 * Follow-ups by position, updated in place.
 *
 * voice_interruption points at a follow-up, so the delete-then-insert the
 * other tables use failed on the first re-import after any pressure session,
 * and it threw away the cached speech with it. So each authored follow-up
 * keeps its row and its id. Its cached audio survives while its words are
 * unchanged, and is cleared when they change, so the line is synthesised
 * again. A follow-up the file no longer has is retired: the cockpit stops
 * serving it, and the past sessions that heard it keep their record.
 */
async function syncFollowUps(
  client: PoolClient,
  questionId: number,
  followUps: Array<{ trigger_after_beat: string; text: string }>,
): Promise<void> {
  for (const [index, f] of followUps.entries()) {
    await client.query(
      `insert into voice_follow_up (voice_question_id, trigger_after_beat, text, ordinal)
       values ($1, $2, $3, $4)
       on conflict (voice_question_id, ordinal) do update
         set trigger_after_beat = excluded.trigger_after_beat,
             text = excluded.text,
             audio_key = case when voice_follow_up.text = excluded.text
                              then voice_follow_up.audio_key end,
             retired_at = null`,
      [questionId, f.trigger_after_beat, f.text, index + 1]);
  }
  await client.query(
    `update voice_follow_up set retired_at = now()
      where voice_question_id = $1 and ordinal > $2 and retired_at is null`,
    [questionId, followUps.length]);
}
