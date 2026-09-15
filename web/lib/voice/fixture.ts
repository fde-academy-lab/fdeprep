/**
 * One question, transcribed from the worked example in docs/07 section 2.
 *
 * Development scaffolding, in the same spirit as the development learner in
 * lib/session/current.ts and the problem fixtures under problems/_fixtures.
 * It exists so the cockpit has beats, anchors and follow-ups to render before
 * the content phase, and it is never published, so it cannot reach a learner
 * through a catalogue.
 *
 * Not authored content. The twelve real questions in docs/07 section 11, with
 * their rubrics and their three exemplars each, are Phase 8's work and belong
 * to whoever writes them.
 */
import { db } from "../db/pool.ts";

const SLUG = "_fixture-explain-why-your-loop-terminates";

/** Verbatim from docs/07 section 2. */
const SOURCE_YAML = `slug: explain-why-your-loop-terminates
title: Explain how you guarantee an agent loop terminates
track: agent-loop
difficulty: medium
total_seconds: 285
prompt_text: |
  A client asks why your agent will not spin forever in production.
  Answer as you would in the room.
beats:
  - { id: b1, label: Name the risk in one sentence, seconds: 30 }
  - { id: b2, label: Name the mechanism that stops it, seconds: 60 }
  - { id: b3, label: Say what happens when the mechanism fires, seconds: 60 }
  - { id: b4, label: Name the case the mechanism does not catch, seconds: 75 }
  - { id: b5, label: Say what you would monitor, seconds: 60 }
# fixture: transcribed from docs/07 section 2, not authored content
`;

const BEATS = [
  { key: "b1", label: "Name the risk in one sentence", seconds: 30,
    anchors: ["loop", "forever", "budget", "never stops", "runaway"] },
  { key: "b2", label: "Name the mechanism that stops it", seconds: 60,
    anchors: ["step budget", "max steps", "call cap", "counter", "ceiling"] },
  { key: "b3", label: "Say what happens when the mechanism fires", seconds: 60,
    anchors: ["degrade", "fallback", "partial answer", "escalate", "hand off"] },
  { key: "b4", label: "Name the case the mechanism does not catch", seconds: 75,
    anchors: ["repeated identical", "same tool", "progress", "no new information"] },
  { key: "b5", label: "Say what you would monitor", seconds: 60,
    anchors: ["alert", "p95", "step count", "dashboard", "log"] },
];

/**
 * Verbatim from docs/07 section 2. The three exemplars that section also names
 * are not here: its own worked example writes them as "...", and an exemplar
 * is assessment content, so inventing three would be inventing the calibration
 * the judge anchors on. Phase 8 writes them. Until then judge/rubric.py renders
 * "None supplied." and the judge scores against the criteria alone.
 */
const RUBRIC = [
  { key: "c1", label: "Correct mechanism", weight: 30 },
  { key: "c2", label: "Names a case the mechanism misses", weight: 30 },
  { key: "c3", label: "Answer a non-engineer could act on", weight: 25 },
  { key: "c4", label: "Holds position under the follow-up", weight: 15 },
];

const FOLLOW_UPS = [
  { after: "b3", text: "The client says a step budget just truncates good answers. Respond." },
  { after: "b4", text: "How would you set the budget number without guessing?" },
];

/** Idempotent: safe to call on every page load, like the development learner. */
export async function fixtureQuestionId(): Promise<number> {
  const pool = db();

  const { rows } = await pool.query<{ id: string }>(
    `insert into voice_question
       (slug, title, track, difficulty, total_seconds, prompt_text, source_yaml, is_published)
     values ($1, 'Explain how you guarantee an agent loop terminates', 'agent-loop', 'medium',
             285,
             'A client asks why your agent will not spin forever in production. ' ||
             'Answer as you would in the room.',
             $2, false)
     on conflict (slug) do update set source_yaml = excluded.source_yaml
     returning id`,
    [SLUG, SOURCE_YAML],
  );
  const id = Number(rows[0]!.id);

  for (const [index, beat] of BEATS.entries()) {
    await pool.query(
      `insert into voice_beat (voice_question_id, beat_key, label, seconds, anchors, ordinal)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (voice_question_id, beat_key)
         do update set label = excluded.label, seconds = excluded.seconds,
                       anchors = excluded.anchors, ordinal = excluded.ordinal`,
      [id, beat.key, beat.label, beat.seconds, beat.anchors, index + 1],
    );
  }

  for (const [index, criterion] of RUBRIC.entries()) {
    await pool.query(
      `insert into voice_rubric_criterion
         (voice_question_id, criterion_key, label, weight, ordinal)
       values ($1, $2, $3, $4, $5)
       on conflict (voice_question_id, criterion_key)
         do update set label = excluded.label, weight = excluded.weight,
                       ordinal = excluded.ordinal`,
      [id, criterion.key, criterion.label, criterion.weight, index + 1],
    );
  }

  for (const [index, followUp] of FOLLOW_UPS.entries()) {
    await pool.query(
      `insert into voice_follow_up
         (voice_question_id, trigger_after_beat, text, ordinal)
       values ($1, $2, $3, $4)
       on conflict (voice_question_id, ordinal)
         do update set trigger_after_beat = excluded.trigger_after_beat, text = excluded.text`,
      [id, followUp.after, followUp.text, index + 1],
    );
  }

  return id;
}
