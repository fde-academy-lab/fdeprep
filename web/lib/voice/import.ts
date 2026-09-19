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
 * here too.
 */
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
         (slug, title, track, difficulty, total_seconds, prompt_text, source_yaml, is_published)
       values ($1, $2, $3, $4, $5, $6, $7, true)
       on conflict (slug) do update
         set title = excluded.title, track = excluded.track,
             difficulty = excluded.difficulty, total_seconds = excluded.total_seconds,
             prompt_text = excluded.prompt_text, source_yaml = excluded.source_yaml,
             is_published = true
       returning id`,
      [q.slug, q.title, q.track, q.difficulty, q.total_seconds, q.prompt_text.trim(), source]);
    const id = Number(rows[0]!.id);

    // Delete then insert, rather than upsert and leave the rest. A beat the
    // author removed has to leave the database too, or the cockpit renders a
    // segment nothing will ever cue.
    for (const table of ["voice_beat", "voice_rubric_criterion", "voice_follow_up",
                         "voice_exemplar"]) {
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

    for (const [index, f] of (q.follow_ups ?? []).entries()) {
      await client.query(
        `insert into voice_follow_up (voice_question_id, trigger_after_beat, text, ordinal)
         values ($1, $2, $3, $4)`,
        [id, f.trigger_after_beat, f.text, index + 1]);
    }

    for (const e of q.exemplars ?? []) {
      await client.query(
        `insert into voice_exemplar (voice_question_id, band, score, transcript)
         values ($1, $2, $3, $4)`,
        [id, e.band, e.score, e.transcript.trim()]);
    }

    return id;
  });
}
