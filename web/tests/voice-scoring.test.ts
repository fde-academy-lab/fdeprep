/**
 * Scoring a finished session end to end, and the deterministic halves on
 * their own. docs/07 section 6.
 *
 * The judge is driven through the real handler by way of a scripted reply, so
 * what is exercised is the actual two-call pipeline rather than a stand-in
 * for it: the parser, the rescale to fifty, and the coverage the score uses.
 */
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { closeDb, db } from "@/lib/db/pool";
import { grantConsent } from "@/lib/voice/consent";
import { fixtureQuestionId } from "@/lib/voice/fixture";
import { scoreVoiceOnce } from "@/lib/voice/judge";
import { loadDebrief } from "@/lib/voice/debrief";
import { finishSession } from "@/lib/voice/persist";
import {
  FIRST_CLAIM_FLOOR_MS,
  FIRST_CLAIM_TARGET_MS,
  PACE_PARTS,
  STRUCTURE_PARTS,
  paceFor,
  scoreVoiceSession,
  structureFor,
  type BeatOutcome,
} from "@/lib/voice/score";
import { startVoiceSession } from "@/lib/voice/start";
import { resetDatabase, seedLearner } from "./helpers.ts";

function beat(overrides: Partial<BeatOutcome> & { ordinal: number }): BeatOutcome {
  return {
    beatKey: `b${overrides.ordinal}`,
    covered: false,
    liveCovered: false,
    reachedAtMs: null,
    spentMs: 0,
    paceState: "never_reached",
    seconds: 60,
    ...overrides,
  };
}

describe("structure", () => {
  test("every beat covered, in order, inside budget, is full marks", () => {
    const beats = [1, 2, 3].map((ordinal) =>
      beat({ ordinal, covered: true, reachedAtMs: ordinal * 1000, paceState: "on_budget" }));
    const structure = structureFor(beats);
    expect(structure.points).toBe(30);
    expect(structure.covered).toBe(3);
    expect(structure.inOrder).toBe(true);
  });

  test("missing a beat costs coverage and nothing else", () => {
    const beats = [
      beat({ ordinal: 1, covered: true, reachedAtMs: 0, paceState: "on_budget" }),
      beat({ ordinal: 2, covered: true, reachedAtMs: 5_000, paceState: "on_budget" }),
      beat({ ordinal: 3 }),
    ];
    const structure = structureFor(beats);
    expect(structure.points).toBe(
      (2 / 3) * STRUCTURE_PARTS.coverage + STRUCTURE_PARTS.order + STRUCTURE_PARTS.withinBudget,
    );
  });

  test("answering out of order costs the order points and keeps the rest", () => {
    const beats = [
      beat({ ordinal: 1, covered: true, reachedAtMs: 40_000, paceState: "on_budget" }),
      beat({ ordinal: 2, covered: true, reachedAtMs: 10_000, paceState: "on_budget" }),
    ];
    const structure = structureFor(beats);
    expect(structure.inOrder).toBe(false);
    expect(structure.points).toBe(STRUCTURE_PARTS.coverage + STRUCTURE_PARTS.withinBudget);
  });

  test("a stretched beat still counts as within budget; an overrun one does not", () => {
    const stretched = structureFor([
      beat({ ordinal: 1, covered: true, reachedAtMs: 0, paceState: "stretching" }),
    ]);
    const overrun = structureFor([
      beat({ ordinal: 1, covered: true, reachedAtMs: 0, paceState: "overrun" }),
    ]);
    expect(stretched.withinBudget).toBe(1);
    expect(overrun.withinBudget).toBe(0);
    expect(stretched.points).toBeGreaterThan(overrun.points);
  });

  test("a question with no beats scores zero rather than dividing by zero", () => {
    expect(structureFor([]).points).toBe(0);
  });
});

describe("pace", () => {
  const closed = { durationMs: 120_000, totalSeconds: 285 };

  test("a claim inside thirty seconds, no overruns and a clean close is full marks", () => {
    const beats = [beat({ ordinal: 1, covered: true, reachedAtMs: 12_000, paceState: "on_budget" })];
    const pace = paceFor(beats, closed);
    expect(pace.points).toBe(20);
    expect(pace.firstClaimMs).toBe(12_000);
    expect(pace.closedInsideClock).toBe(true);
  });

  test("a slow opening loses marks gradually rather than all at once", () => {
    const at = (ms: number) =>
      paceFor([beat({ ordinal: 1, covered: true, reachedAtMs: ms, paceState: "on_budget" })], closed)
        .points;

    expect(at(FIRST_CLAIM_TARGET_MS)).toBe(20);
    expect(at(60_000)).toBeLessThan(20);
    expect(at(60_000)).toBeGreaterThan(at(80_000));
    expect(at(FIRST_CLAIM_FLOOR_MS)).toBe(20 - PACE_PARTS.firstClaim);
  });

  test("an answer that ran out the clock did not close", () => {
    const beats = [beat({ ordinal: 1, covered: true, reachedAtMs: 1_000, paceState: "on_budget" })];
    const pace = paceFor(beats, { durationMs: 285_000, totalSeconds: 285 });
    expect(pace.closedInsideClock).toBe(false);
    expect(pace.points).toBe(20 - PACE_PARTS.closed);
  });

  test("an answer that never made a claim scores nothing for the first one", () => {
    const pace = paceFor([beat({ ordinal: 1 })], closed);
    expect(pace.firstClaimMs).toBe(null);
    expect(pace.points).toBe(PACE_PARTS.overruns + PACE_PARTS.closed);
  });
});

describe("the whole score", () => {
  test("the three axes add to the total and each is capped at its weight", () => {
    const beats = [1, 2].map((ordinal) =>
      beat({ ordinal, covered: true, reachedAtMs: ordinal * 5_000, paceState: "on_budget" }));
    const score = scoreVoiceSession({
      contentPoints: 999, beats, durationMs: 60_000, totalSeconds: 285,
    });
    expect(score.content.points).toBe(50);
    expect(score.total).toBe(score.content.points + score.structure.points + score.pace.points);
    expect(score.total).toBeLessThanOrEqual(100);
  });

  test("an answer that said nothing scores zero rather than erroring", () => {
    const score = scoreVoiceSession({
      contentPoints: 0,
      beats: [beat({ ordinal: 1 }), beat({ ordinal: 2 })],
      durationMs: 285_000,
      totalSeconds: 285,
    });
    expect(score.total).toBe(PACE_PARTS.overruns);
  });
});

describe("the pipeline, from a finished session to a debrief", () => {
  beforeEach(async () => {
    await resetDatabase();
    process.env.VOICE_TOKEN_SECRET = "a-test-secret";
    process.env.VOICE_SOCKET_URL = "ws://localhost:8787";
  });

  afterAll(async () => {
    await closeDb();
  });

  async function finishedSession() {
    const learner = await seedLearner();
    await grantConsent(learner.enrolmentId);
    const questionId = await fixtureQuestionId();
    const started = await startVoiceSession({
      enrolmentId: learner.enrolmentId,
      cohortId: learner.cohortId,
      voiceQuestionId: questionId,
      mode: "unguided",
    });

    await finishSession({
      sessionId: started.sessionId,
      enrolmentId: learner.enrolmentId,
      transcript: "the agent could loop so we set a step budget and then it degrades",
      segments: [
        { text: "the agent could loop", startMs: 0, endMs: 4_000 },
        { text: "so we set a step budget", startMs: 6_000, endMs: 11_000 },
        { text: "and then it degrades", startMs: 12_000, endMs: 15_000 },
      ],
      timeline: {
        beats: [
          { beatKey: "b1", liveCovered: true, reachedAtMs: 0, spentMs: 12_000, paceState: "on_budget" },
          { beatKey: "b2", liveCovered: true, reachedAtMs: 12_000, spentMs: 30_000, paceState: "on_budget" },
          { beatKey: "b3", liveCovered: true, reachedAtMs: 42_000, spentMs: 20_000, paceState: "on_budget" },
          { beatKey: "b4", liveCovered: false, reachedAtMs: null, spentMs: 0, paceState: "never_reached" },
          { beatKey: "b5", liveCovered: false, reachedAtMs: null, spentMs: 0, paceState: "never_reached" },
        ],
        nudges: [
          { atMs: 25_000, kind: "silence", line: "Say the next step out loud.", wasShown: false },
          { atMs: 70_000, kind: "overrun", line: "Move on. Two beats left.", wasShown: false },
        ],
      },
    });
    return { learner, sessionId: started.sessionId };
  }

  /** The scripted judge. Two replies, the two calls docs/07 allows. */
  function scriptedJudge(covered: boolean[], criteria: number[]) {
    const keys = ["b1", "b2", "b3", "b4", "b5"];
    const weights = [30, 30, 25, 15];
    return async () => ({
      status: "ok",
      content_points: Math.round(
        (criteria.reduce((a, b) => a + b, 0) / weights.reduce((a, b) => a + b, 0)) * 50 * 100,
      ) / 100,
      content_out_of: 50,
      criteria: criteria.map((score, index) => ({
        criterion_id: `c${index + 1}`, score, evidence_quote: "a step budget", grounded: true,
      })),
      beats: keys.map((key, index) => ({
        beat_key: key, covered: covered[index] ?? false, evidence_quote: "a step budget",
      })),
      summary: "The answer never reached the case a step budget does not catch.",
      model_calls: 2,
    });
  }

  test("a finished session is scored and the debrief shows all five panels", async () => {
    const { learner, sessionId } = await finishedSession();

    const scored = await scoreVoiceOnce({
      invoke: scriptedJudge([true, true, true, false, false], [24, 0, 20, 10]),
    });
    expect(scored).toBe(1);

    const debrief = await loadDebrief(sessionId, learner.enrolmentId);
    expect(debrief.scored).toBe(true);
    expect(debrief.score!.content).toBeGreaterThan(0);
    expect(debrief.score!.structure).toBeGreaterThan(0);
    expect(debrief.score!.total).toBe(
      debrief.score!.content + debrief.score!.structure + debrief.score!.pace,
    );

    expect(debrief.beats.map((b) => b.covered)).toEqual([true, true, true, false, false]);
    // docs/07 section 6: the TERRITORY NOT ENTERED panel is the anchors of
    // beats the answer never reached.
    expect(debrief.territoryNotEntered).toContain("same tool");
    expect(debrief.judgeSummary).toMatch(/never reached/);
    expect(debrief.delivery.wordsPerMinute).toBeGreaterThan(0);
    expect(debrief.transcript).toMatch(/step budget/);
  });

  /** docs/07 section 7: the two passes can disagree, and the debrief shows
   *  the final result while the replay shows what the live pass did. */
  test("the judge overrides the live pass and both are kept", async () => {
    const { learner, sessionId } = await finishedSession();
    // The cockpit lit b3; the judge says the answer only gestured at it.
    await scoreVoiceOnce({ invoke: scriptedJudge([true, true, false, false, false], [20, 0, 15, 5]) });

    const debrief = await loadDebrief(sessionId, learner.enrolmentId);
    const b3 = debrief.beats.find((beat) => beat.key === "b3")!;
    expect(b3.liveCovered).toBe(true);
    expect(b3.covered).toBe(false);
  });

  test("a session is scored once, however often the worker runs", async () => {
    await finishedSession();
    const judge = scriptedJudge([true, false, false, false, false], [10, 0, 5, 0]);
    expect(await scoreVoiceOnce({ invoke: judge })).toBe(1);
    expect(await scoreVoiceOnce({ invoke: judge })).toBe(0);
  });

  test("a judge that fails leaves the session unscored rather than guessing", async () => {
    const { learner, sessionId } = await finishedSession();
    await scoreVoiceOnce({ invoke: async () => ({ status: "error", message: "no model" }) });

    const debrief = await loadDebrief(sessionId, learner.enrolmentId);
    expect(debrief.scored).toBe(false);
    expect(debrief.score).toBe(null);
    // The beats and the nudges the cockpit recorded are still there, so the
    // replay works while the score is pending.
    expect(debrief.beats).toHaveLength(5);
    expect(debrief.nudges).toHaveLength(2);
  });

  /** docs/07 section 4: unguided computes every nudge and shows none, and the
   *  replay is where the learner finally sees them. */
  test("an unguided session's nudges are all stored unshown and reach the replay", async () => {
    const { learner, sessionId } = await finishedSession();
    const debrief = await loadDebrief(sessionId, learner.enrolmentId);
    expect(debrief.mode).toBe("unguided");
    expect(debrief.nudges).toHaveLength(2);
    expect(debrief.nudges.every((nudge) => !nudge.wasShown)).toBe(true);
    expect(debrief.nudges.map((nudge) => nudge.atMs)).toEqual([25_000, 70_000]);
  });

  test("a session belonging to someone else is not readable", async () => {
    const { sessionId } = await finishedSession();
    const other = await seedLearner({ githubId: 77, login: "other" });
    await expect(loadDebrief(sessionId, other.enrolmentId)).rejects.toThrow(/not yours/);
  });
});

describe("the voice caps", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  /** docs/07 section 10. Pressure is absent on purpose: it spends the
   *  rehearsal allowance, which that section says it shares. */
  test("guided and unguided are six a day and pressure has no scope of its own", async () => {
    const { rows } = await db().query<{ scope: string; max_count: number; window_s: number }>(
      "select scope::text as scope, max_count, window_s from rate_limit_policy " +
      "where scope::text like 'voice%' order by scope",
    );
    expect(rows).toEqual([
      { scope: "voice_guided_daily", max_count: 6, window_s: 86_400 },
      { scope: "voice_unguided_daily", max_count: 6, window_s: 86_400 },
    ]);

    const { rows: rehearsal } = await db().query<{ max_count: number }>(
      "select max_count from rate_limit_policy where scope = 'rehearsal_weekly'",
    );
    expect(rehearsal[0]!.max_count).toBe(2);
  });
});
