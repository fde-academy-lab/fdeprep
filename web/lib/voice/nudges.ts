/**
 * The nudge engine. docs/07 section 3.
 *
 * A pure function of elapsed time, beat state, the partial transcript and
 * when the last nudge fired. Nothing else: no clock, no random, no fetch. So
 * a test drives a whole session in a loop with no audio, and the Phase 7c
 * replay gets the same lines in the same places against a recording.
 *
 * Unguided mode calls this too and draws none of it. docs/07 section 4 wants
 * the replay to show "the nudges that would have fired appearing where they
 * would have fired", which only works if they were computed at the time.
 */
import { currentBeat, type BeatState } from "./cues.ts";

/** docs/07 section 3: "minimum 20 seconds between nudges". */
export const MIN_GAP_MS = 20_000;

/** Silence over five seconds. */
export const SILENCE_MS = 5_000;

/** No anchor from any beat for twenty seconds while the learner is talking. */
export const OFF_QUESTION_MS = 20_000;

/** Under fifteen seconds of the whole answer remaining. */
export const CLOSING_MS = 15_000;

/** docs/07 section 3: "never more than nine words". */
export const MAX_WORDS = 9;

export type NudgeKind = "closing" | "silence" | "overrun" | "skipped" | "off_question";

export type Nudge = { kind: NudgeKind; line: string; atMs: number };

export type NudgeInput = {
  elapsedMs: number;
  beatState: BeatState;
  /** Read for length only. Never rendered, never announced. */
  partialTranscript: string;
  lastNudgeAt: number | null;
};

export type NudgeContext = {
  totalSeconds: number;
  /** Kinds already fired on the beat index they fired on, so a rule that
   *  stays true does not fire every twenty seconds for the rest of a beat. */
  firedOnBeat: ReadonlySet<string>;
};

function beatsLeftLine(remaining: number): string {
  if (remaining <= 0) return "Move on. Last beat.";
  if (remaining === 1) return "Move on. One beat left.";
  const words = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven"];
  return `Move on. ${words[remaining] ?? String(remaining)} beats left.`;
}

/**
 * The next nudge, or null.
 *
 * Order is by how little time the learner has to act on it. Under fifteen
 * seconds left makes every other rule moot. A learner who has gone silent is
 * stuck and nothing else matters until they speak. Then the current beat
 * overrunning, then the structural miss, then having left the question, which
 * is the one a learner can recover from without help.
 */
export function nextNudge(input: NudgeInput, context: NudgeContext): Nudge | null {
  const { elapsedMs, beatState, lastNudgeAt } = input;

  if (lastNudgeAt !== null && elapsedMs - lastNudgeAt < MIN_GAP_MS) return null;

  const beat = currentBeat(beatState);
  const index = beatState.currentIndex;
  const fired = (kind: NudgeKind) => context.firedOnBeat.has(`${kind}:${index}`);
  const remainingMs = context.totalSeconds * 1000 - elapsedMs;

  // Once per session rather than once per beat: the clock runs out exactly
  // once, and the learner only needs telling once.
  if (remainingMs <= CLOSING_MS && remainingMs > 0 && !context.firedOnBeat.has("closing")) {
    return { kind: "closing", line: "Close it now.", atMs: elapsedMs };
  }

  if (elapsedMs - beatState.lastVoiceAtMs >= SILENCE_MS && !fired("silence")) {
    return { kind: "silence", line: "Say the next step out loud.", atMs: elapsedMs };
  }

  if (beat && beat.pace === "overrun" && !fired("overrun")) {
    return {
      kind: "overrun",
      line: beatsLeftLine(beatState.beats.length - index - 1),
      atMs: elapsedMs,
    };
  }

  if (beat?.skipped && !fired("skipped")) {
    return { kind: "skipped", line: "You jumped past the constraint.", atMs: elapsedMs };
  }

  // Talking, and none of it has landed on a landmark for twenty seconds. A
  // learner who has said nothing at all is silent, not off-question, and the
  // rule above already covered them.
  const talking = elapsedMs - beatState.lastVoiceAtMs < SILENCE_MS;
  if (talking && elapsedMs - beatState.lastAnchorAtMs >= OFF_QUESTION_MS && !fired("off_question")) {
    return { kind: "off_question", line: "You have left the question.", atMs: elapsedMs };
  }

  return null;
}

/** The key the caller adds to firedOnBeat once it has shown, or recorded, a
 *  nudge. Closing is per session; everything else is per beat. */
export function firedKey(nudge: Nudge, beatIndex: number): string {
  return nudge.kind === "closing" ? "closing" : `${nudge.kind}:${beatIndex}`;
}

export function wordCount(line: string): number {
  return line.trim().split(/\s+/).length;
}
