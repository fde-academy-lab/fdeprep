/**
 * The cue and nudge engines, driven without audio.
 *
 * Everything here is a pure function or a wrapper over two, which is the
 * point of building them that way: a whole five minute answer runs in a loop
 * in under a millisecond, and the Phase 7c replay will get the same lines in
 * the same places.
 */
import { describe, expect, test } from "vitest";
import {
  advance,
  anchorsHitIn,
  currentBeat,
  initialState,
  normalise,
  OVERRUN_AT,
  paceStateFor,
  STRETCHING_AT,
  territory,
  type Beat,
} from "@/lib/voice/cues";
import { MAX_WORDS, MIN_GAP_MS, wordCount } from "@/lib/voice/nudges";
import { CockpitRun } from "@/lib/voice/run";

/** Transcribed from the worked example in docs/07 section 2. */
const BEATS: Beat[] = [
  { key: "b1", label: "Name the risk in one sentence", seconds: 30, ordinal: 1,
    anchors: ["loop", "forever", "budget", "never stops", "runaway"] },
  { key: "b2", label: "Name the mechanism that stops it", seconds: 60, ordinal: 2,
    anchors: ["step budget", "max steps", "call cap", "counter", "ceiling"] },
  { key: "b3", label: "Say what happens when the mechanism fires", seconds: 60, ordinal: 3,
    anchors: ["degrade", "fallback", "partial answer", "escalate", "hand off"] },
  { key: "b4", label: "Name the case the mechanism does not catch", seconds: 75, ordinal: 4,
    anchors: ["repeated identical", "same tool", "progress", "no new information"] },
  { key: "b5", label: "Say what you would monitor", seconds: 60, ordinal: 5,
    anchors: ["alert", "p95", "step count", "dashboard", "log"] },
];

const TOTAL_SECONDS = 285;

describe("normalising a transcript", () => {
  test("case, punctuation and spacing stop mattering", () => {
    expect(normalise("Step-Budget,  runs   OUT.")).toBe(" step budget runs out ");
  });

  test("an anchor matches whole words only", () => {
    expect(anchorsHitIn("we set a step budget of six", ["step budget"])).toEqual(["step budget"]);
    expect(anchorsHitIn("budgeting is hard", ["budget"])).toEqual([]);
    // Punctuation between the words still matches, because normalising is
    // what makes "step-budget" and "Step Budget" the same landmark and it
    // cannot tell a hyphen from a comma. docs/07 section 7 wants the live
    // pass wrong in the forgiving direction, and this is that direction.
    expect(anchorsHitIn("the step, budget aside", ["step budget"])).toEqual(["step budget"]);
  });

  test("Transcribe's own punctuation does not break a multi-word anchor", () => {
    expect(anchorsHitIn("it will hand off, to a human", ["hand off"])).toEqual(["hand off"]);
  });
});

describe("pace states", () => {
  test("the thresholds are the ones docs/07 section 3 names", () => {
    expect(STRETCHING_AT).toBe(1.3);
    expect(OVERRUN_AT).toBe(1.75);
  });

  test("a sixty second beat stretches at 78 seconds and overruns at 105", () => {
    expect(paceStateFor(77_999, 60)).toBe("on_budget");
    expect(paceStateFor(78_000, 60)).toBe("stretching");
    expect(paceStateFor(104_999, 60)).toBe("stretching");
    expect(paceStateFor(105_000, 60)).toBe("overrun");
  });
});

describe("the beat track", () => {
  test("the first beat is current from the start and the rest are not reached", () => {
    const state = initialState(BEATS);
    expect(currentBeat(state)?.key).toBe("b1");
    expect(state.beats.map((b) => b.pace)).toEqual([
      "on_budget", "never_reached", "never_reached", "never_reached", "never_reached",
    ]);
  });

  test("saying an anchor covers the beat and moves the current one on", () => {
    let state = initialState(BEATS);
    state = advance(state, { elapsedMs: 4_000, partialTranscript: "it could loop", voiced: true });
    expect(state.beats[0]!.covered).toBe(true);
    expect(state.beats[0]!.coveredAtMs).toBe(4_000);
    expect(currentBeat(state)?.key).toBe("b2");
  });

  test("time is charged to the beat that was current across the interval", () => {
    let state = initialState(BEATS);
    state = advance(state, { elapsedMs: 10_000, partialTranscript: "", voiced: true });
    state = advance(state, { elapsedMs: 12_000, partialTranscript: "a loop", voiced: true });
    // Covering b1 at 12s still charges b1 the twelve seconds it took.
    expect(state.beats[0]!.spentMs).toBe(12_000);
    expect(state.beats[1]!.spentMs).toBe(0);
  });

  test("a later beat covered first marks the ones it jumped", () => {
    let state = initialState(BEATS);
    state = advance(state, {
      elapsedMs: 8_000,
      partialTranscript: "we would escalate to a human",
      voiced: true,
    });
    expect(state.beats[2]!.covered).toBe(true);
    expect(state.beats[0]!.skipped).toBe(true);
    expect(state.beats[1]!.skipped).toBe(true);
    expect(state.beats[3]!.skipped).toBe(false);
    expect(currentBeat(state)?.key).toBe("b1");
  });

  test("the territory row shows the current beat's anchors and nobody else's", () => {
    let state = initialState(BEATS);
    state = advance(state, { elapsedMs: 3_000, partialTranscript: "a loop", voiced: true });
    const row = territory(state);
    expect(row.map((t) => t.term)).toEqual(BEATS[1]!.anchors);
    expect(row.every((t) => !t.hit)).toBe(true);

    // Saying "counter" both lights the term and covers b2, so the row the
    // learner sees next is b3's. The durable record of having landed it is
    // the beat track filling, which is the primary instrument.
    state = advance(state, {
      elapsedMs: 9_000,
      partialTranscript: "a loop with a counter",
      voiced: true,
    });
    expect(state.beats[1]!.hitAnchors).toEqual(["counter"]);
    expect(territory(state).map((t) => t.term)).toEqual(BEATS[2]!.anchors);
  });

  test("advancing never mutates the state it was given, so a replay can step back", () => {
    const first = initialState(BEATS);
    const second = advance(first, { elapsedMs: 5_000, partialTranscript: "loop", voiced: true });
    expect(first.beats[0]!.covered).toBe(false);
    expect(second.beats[0]!.covered).toBe(true);
    expect(first.elapsedMs).toBe(0);
  });
});

/** docs/07 section 3, the five conditions and their exact lines. */
describe("nudges", () => {
  function run(showsNudges = true) {
    return new CockpitRun(BEATS, TOTAL_SECONDS, showsNudges);
  }

  test("five seconds of silence asks for the next step out loud", () => {
    const cockpit = run();
    expect(cockpit.advanceTo({ elapsedMs: 4_900, partialTranscript: "", voiced: false })).toBe(null);
    const nudge = cockpit.advanceTo({ elapsedMs: 5_000, partialTranscript: "", voiced: false });
    expect(nudge?.kind).toBe("silence");
    expect(nudge?.line).toBe("Say the next step out loud.");
  });

  test("an overrunning beat says how many are left", () => {
    const cockpit = run();
    // b1 has a thirty second budget, so overrun begins at 52.5 seconds.
    cockpit.advanceTo({ elapsedMs: 53_000, partialTranscript: "talking", voiced: true });
    const nudge = cockpit.recordedNudges.at(-1);
    expect(nudge?.kind).toBe("overrun");
    expect(nudge?.line).toBe("Move on. Four beats left.");
  });

  test("jumping a beat says so", () => {
    const cockpit = run();
    cockpit.advanceTo({
      elapsedMs: 6_000,
      partialTranscript: "we would escalate to a human",
      voiced: true,
    });
    expect(cockpit.recordedNudges.at(-1)?.line).toBe("You jumped past the constraint.");
  });

  test("talking without touching a landmark for twenty seconds says so", () => {
    const cockpit = run();
    for (let at = 1_000; at <= 21_000; at += 1_000) {
      cockpit.advanceTo({ elapsedMs: at, partialTranscript: "so anyway last week", voiced: true });
    }
    const kinds = cockpit.recordedNudges.map((n) => n.kind);
    expect(kinds).toContain("off_question");
  });

  test("the last fifteen seconds say to close it, once", () => {
    const cockpit = run();
    for (let at = 269_000; at <= 284_000; at += 1_000) {
      cockpit.advanceTo({ elapsedMs: at, partialTranscript: "a loop and a counter", voiced: true });
    }
    expect(cockpit.recordedNudges.filter((n) => n.kind === "closing")).toHaveLength(1);
  });

  /** The rule the user called out: one line at a time, never two, and never
   *  inside twenty seconds of the last one. */
  test("no two nudges land within twenty seconds of each other", () => {
    const cockpit = run();
    // A worst case: silent, overrunning, off-question and closing all at once,
    // driven at ten ticks a second for the whole answer.
    for (let at = 100; at <= TOTAL_SECONDS * 1000; at += 100) {
      cockpit.advanceTo({ elapsedMs: at, partialTranscript: "", voiced: false });
    }
    const times = cockpit.recordedNudges.map((n) => n.atMs);
    expect(times.length).toBeGreaterThan(1);
    for (const [index, at] of times.entries()) {
      if (index === 0) continue;
      expect(at - times[index - 1]!).toBeGreaterThanOrEqual(MIN_GAP_MS);
    }
  });

  test("only one nudge is ever on screen", () => {
    const cockpit = run();
    for (let at = 100; at <= 120_000; at += 100) {
      cockpit.advanceTo({ elapsedMs: at, partialTranscript: "", voiced: false });
    }
    // visibleNudge is a single value by construction, and the slot renders it.
    expect(cockpit.visibleNudge === null || typeof cockpit.visibleNudge.line).toBeTruthy();
    expect(cockpit.recordedNudges.filter((n) => n.atMs === cockpit.visibleNudge?.atMs)).toHaveLength(1);
  });

  test("no nudge line runs past nine words", () => {
    const cockpit = run();
    for (let at = 100; at <= TOTAL_SECONDS * 1000; at += 100) {
      cockpit.advanceTo({
        elapsedMs: at,
        partialTranscript: at > 200_000 ? "we would escalate" : "",
        voiced: at % 3_000 !== 0,
      });
    }
    expect(cockpit.recordedNudges.length).toBeGreaterThan(0);
    for (const nudge of cockpit.recordedNudges) {
      expect(wordCount(nudge.line), nudge.line).toBeLessThanOrEqual(MAX_WORDS);
    }
  });

  /** docs/07 section 4 and the was_shown column in section 8. */
  test("unguided computes every nudge and marks every one as not shown", () => {
    const guided = run(true);
    const unguided = run(false);
    for (let at = 100; at <= TOTAL_SECONDS * 1000; at += 100) {
      const tick = { elapsedMs: at, partialTranscript: "", voiced: false };
      guided.advanceTo(tick);
      unguided.advanceTo(tick);
    }
    expect(unguided.recordedNudges.map((n) => [n.atMs, n.line])).toEqual(
      guided.recordedNudges.map((n) => [n.atMs, n.line]),
    );
    expect(unguided.recordedNudges.every((n) => !n.wasShown)).toBe(true);
    expect(guided.recordedNudges.every((n) => n.wasShown)).toBe(true);
    expect(unguided.visibleNudge).toBe(null);
  });

  test("the timeline is in the shape the two tables take", () => {
    const cockpit = run();
    cockpit.advanceTo({ elapsedMs: 9_000, partialTranscript: "a loop", voiced: true });
    const timeline = cockpit.timeline();
    expect(timeline.beats).toHaveLength(5);
    expect(timeline.beats[0]).toMatchObject({
      beatKey: "b1", liveCovered: true, paceState: "on_budget",
    });
    expect(timeline.beats[4]).toMatchObject({ beatKey: "b5", liveCovered: false });
  });
});
