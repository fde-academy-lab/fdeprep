/**
 * A question row for the transport test page, and nothing else.
 *
 * voice_session references voice_question, so the lab needs a row to point
 * at. This is development scaffolding in the same spirit as the development
 * learner in lib/session/current.ts: it exists so a screen has something to
 * run against before the content phase. It is never published, so it cannot
 * reach a learner through the catalogue.
 *
 * The twelve real questions, with beats, anchors, rubrics and exemplars, are
 * authored content and land in Phase 8.
 */
import { db } from "../db/pool.ts";

const SLUG = "_lab-transport-check";

export async function labQuestionId(): Promise<number> {
  const { rows } = await db().query<{ id: string }>(
    `insert into voice_question
       (slug, title, track, difficulty, total_seconds, prompt_text, source_yaml, is_published)
     values ($1, 'Transport check', 'agent-loop', 'medium', 300,
             'Speak for a few seconds so the socket has something to carry.',
             'fixture: not authored content', false)
     on conflict (slug) do update set title = excluded.title
     returning id`,
    [SLUG],
  );
  return Number(rows[0]!.id);
}
