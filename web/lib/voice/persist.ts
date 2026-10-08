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
import {
  release, VOICE_FREE_SHORT_ANSWERS_PER_DAY, voiceAnswerCounts, voiceScope,
} from "../policy/caps.ts";
import type { PaceState } from "./cues.ts";
import type { Segment } from "./delivery.ts";
import type { VoiceMode } from "./start.ts";

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

/** Words in a transcript, counted the same way for every answer. */
export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Close the session and store the timeline, in one transaction.
 *
 * Refuses a session that is already finished, so a replayed or duplicated
 * request cannot append a second set of beat results to the same sitting.
 * An answer that ended before it counted gives its allowance back in the
 * same transaction, so the unit and the finished row never disagree, and it
 * is marked as not counted so the scorer never sends it to the judge: two
 * model calls on an answer that said nothing buy nothing. Past the daily
 * bound on free short answers, a short answer counts and is scored.
 *
 * Interview mode, docs/07 section 5a: an answer that counted leaves the
 * session open for its follow-up rounds, with answer_finished_at marking
 * where the main answer ended, and returns `rounds: true` for the route to
 * open the first one. One that did not count closes as any other mode does,
 * with no rounds. A second request for a main answer already stored writes
 * nothing and returns `rounds: true` again, so a retry whose first reply was
 * lost gets the round back.
 */
export async function finishSession(input: {
  sessionId: number;
  enrolmentId: number;
  transcript: string;
  /** Per-segment timings, which the delivery metrics need and the joined
   *  transcript cannot carry. */
  segments?: Segment[];
  timeline: TimelineIn;
}): Promise<{ rounds: boolean }> {
  return await inTransaction(async (client) => {
    const { rows } = await client.query<{
      id: string; mode: VoiceMode; started_at: Date; spent_allowance: boolean; running_ms: number;
      answered: boolean;
    }>(
      `select id, mode, started_at, spent_allowance, answer_finished_at is not null as answered,
              (extract(epoch from (now() - started_at)) * 1000)::int as running_ms
         from voice_session
        where id = $1 and enrolment_id = $2 and finished_at is null
        for update`,
      [input.sessionId, input.enrolmentId],
    );
    const session = rows[0];
    if (!session) {
      throw new SessionNotOpen(
        "That voice session is already finished, or it is not yours. Nothing was changed.",
      );
    }
    if (session.mode === "interview" && session.answered) return { rounds: true };

    // The clock is the server's. The word count comes from the browser's
    // transcript and only matters inside the first thirty seconds, so a
    // browser that under-reports words saves itself at most half a minute.
    const counts = voiceAnswerCounts({
      durationMs: session.running_ms, words: wordCount(input.transcript),
    });
    let free = false;
    if (session.spent_allowance && !counts) {
      const { rows: earlier } = await client.query<{ n: string }>(
        `select count(*) as n from voice_session
          where enrolment_id = $1 and mode = $2 and id <> $3
            and finished_at > now() - interval '1 day'
            and judge_result ->> 'skipped' = 'did_not_count'`,
        [input.enrolmentId, session.mode, input.sessionId]);
      free = Number(earlier[0]!.n) < VOICE_FREE_SHORT_ANSWERS_PER_DAY;
    }
    if (free) {
      await release(client, {
        enrolmentId: input.enrolmentId, scope: voiceScope(session.mode), at: session.started_at,
      });
    }

    // An interview whose answer counted stays open for its rounds; every
    // other session, and an interview answer that did not count, closes now.
    // A close takes any resume claims with it.
    const rounds = session.mode === "interview" && counts;
    await client.query(
      `update voice_session
          set finished_at = case when $5 then null else now() end,
              answer_finished_at = case when mode = 'interview' then now() end,
              transcript = $2, transcript_segments = $3,
              spent_allowance = spent_allowance and not $4,
              scored_at = case when $4 then now() end,
              judge_result = case when $4 then '{"skipped":"did_not_count"}'::jsonb end,
              resume_claims = case when $5 then resume_claims end,
              resume_claims_at = case when $5 then resume_claims_at end
        where id = $1`,
      [input.sessionId, input.transcript, JSON.stringify(input.segments ?? []), free, rounds],
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
    return { rounds };
  });
}
