/**
 * Writing what the cockpit did.
 *
 * Two tables from docs/07 section 8, plus the interruption record from
 * section 5. Everything here is the live pass, which section 7 is explicit is
 * "fast, free, occasionally wrong". The judge decides coverage in the debrief
 * and writes voice_beat_result.covered then; this writes live_covered, which
 * means "the cockpit lit this beat" and is a fact about the cockpit.
 *
 * That is also why the browser is allowed to be the source: what a cockpit
 * showed is only knowable at the cockpit. Nothing written here reaches a
 * score, a heatmap or the placement export.
 */
import { inTransaction } from "../db/pool.ts";
import type { PaceState } from "./cues.ts";

export type TimelineIn = {
  beats: {
    beatKey: string;
    liveCovered: boolean;
    reachedAtMs: number | null;
    spentMs: number;
    paceState: PaceState;
  }[];
  nudges: { atMs: number; kind: string; line: string; wasShown: boolean }[];
  interruptions?: { followUpId: number; firedAtMs: number; endedAtMs: number | null }[];
};

export class SessionNotOpen extends Error {
  readonly status = 409;
}

const PACE_STATES: PaceState[] = ["on_budget", "stretching", "overrun", "never_reached"];

/**
 * Close the session and store the timeline, in one transaction.
 *
 * Refuses a session that is already finished, so a replayed or duplicated
 * request cannot append a second set of beat results to the same sitting.
 */
export async function finishSession(input: {
  sessionId: number;
  enrolmentId: number;
  transcript: string;
  timeline: TimelineIn;
}): Promise<void> {
  await inTransaction(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `select id from voice_session
        where id = $1 and enrolment_id = $2 and finished_at is null
        for update`,
      [input.sessionId, input.enrolmentId],
    );
    if (!rows[0]) {
      throw new SessionNotOpen(
        "That voice session is already finished, or it is not yours. Nothing was changed.",
      );
    }

    await client.query(
      "update voice_session set finished_at = now(), transcript = $2 where id = $1",
      [input.sessionId, input.transcript],
    );

    for (const beat of input.timeline.beats) {
      const pace = PACE_STATES.includes(beat.paceState) ? beat.paceState : "never_reached";
      await client.query(
        `insert into voice_beat_result
           (voice_session_id, beat_key, covered, live_covered, reached_at_ms, spent_ms, pace_state)
         values ($1, $2, false, $3, $4, $5, $6)`,
        // covered stays false until the judge answers it in Phase 7c. A live
        // pass writing into the scored column is the mistake this column
        // split exists to prevent.
        [input.sessionId, beat.beatKey, beat.liveCovered, beat.reachedAtMs,
         Math.round(beat.spentMs), pace],
      );
    }

    for (const nudge of input.timeline.nudges) {
      await client.query(
        `insert into voice_nudge (voice_session_id, at_ms, kind, line, was_shown)
         values ($1, $2, $3, $4, $5)`,
        [input.sessionId, Math.round(nudge.atMs), nudge.kind, nudge.line, nudge.wasShown],
      );
    }

    for (const interruption of input.timeline.interruptions ?? []) {
      await client.query(
        `insert into voice_interruption
           (voice_session_id, voice_follow_up_id, fired_at_ms, ended_at_ms)
         values ($1, $2, $3, $4)
         on conflict (voice_session_id, voice_follow_up_id) do nothing`,
        [input.sessionId, interruption.followUpId, Math.round(interruption.firedAtMs),
         interruption.endedAtMs === null ? null : Math.round(interruption.endedAtMs)],
      );
    }
  });
}
