/**
 * The live cue engine. docs/07 section 3 and section 7.
 *
 * Every function here is pure. That is not tidiness: the same engine runs
 * live in the cockpit, again in unguided mode where nothing is drawn, and a
 * third time in the Phase 7c replay against a recording. Three callers, one
 * answer, and a test can drive all of it without a microphone.
 *
 * What this is not: scoring. docs/07 section 7 calls the live pass "fast,
 * free, occasionally wrong, and wrong in the forgiving direction", and says
 * the judge decides coverage in the debrief. So `covered` here means "the
 * cockpit lit this beat", which is a fact about the cockpit, and the two are
 * allowed to disagree.
 *
 * No model call happens in this file, or anywhere it is called from during an
 * answer. Anchor matching is substring comparison over normalised text.
 */

export type Beat = {
  key: string;
  label: string;
  seconds: number;
  anchors: string[];
  ordinal: number;
};

/** docs/07 section 3: STRETCHING past 130 percent of the beat's seconds,
 *  OVERRUN past 175 percent. */
export const STRETCHING_AT = 1.3;
export const OVERRUN_AT = 1.75;

export type PaceState = "on_budget" | "stretching" | "overrun" | "never_reached";

/** The three words the pace band shows, and the only place they are spelled.
 *  A screen reader gets the same string, because the band is text. */
export const PACE_WORD: Record<PaceState, string> = {
  on_budget: "ON BUDGET",
  stretching: "STRETCHING",
  overrun: "OVERRUN",
  never_reached: "NOT REACHED",
};

export type BeatProgress = {
  key: string;
  label: string;
  seconds: number;
  anchors: string[];
  /** The cockpit lit this beat. Not the judge's answer. */
  covered: boolean;
  /** Anchors seen so far, in the order they were first seen. The territory
   *  row brightens exactly these. */
  hitAnchors: string[];
  /** When this beat became the current one. */
  reachedAtMs: number | null;
  coveredAtMs: number | null;
  /** Time spent as the current beat. */
  spentMs: number;
  pace: PaceState;
  /** A later beat was covered while this one was still uncovered. */
  skipped: boolean;
};

/**
 * Everything the engine accumulates, and the second argument to nextNudge.
 *
 * It carries more than beats because the nudge rules need more than beats:
 * silence needs to know when a voice was last heard, and leaving the question
 * needs to know when an anchor was last hit. Keeping those here rather than
 * in five separate parameters is what lets the nudge function stay a function
 * of four things.
 */
export type BeatState = {
  beats: BeatProgress[];
  /** First uncovered beat, or beats.length once every beat is covered. */
  currentIndex: number;
  elapsedMs: number;
  /** Last moment the microphone carried something above the silence floor. */
  lastVoiceAtMs: number;
  /** Last moment any anchor of any beat was first hit. */
  lastAnchorAtMs: number;
};

export function initialState(beats: Beat[]): BeatState {
  const ordered = [...beats].sort((a, b) => a.ordinal - b.ordinal);
  return {
    beats: ordered.map((beat, index) => ({
      key: beat.key,
      label: beat.label,
      seconds: beat.seconds,
      anchors: beat.anchors,
      covered: false,
      hitAnchors: [],
      reachedAtMs: index === 0 ? 0 : null,
      coveredAtMs: null,
      spentMs: 0,
      pace: index === 0 ? "on_budget" : "never_reached",
      skipped: false,
    })),
    currentIndex: 0,
    elapsedMs: 0,
    lastVoiceAtMs: 0,
    lastAnchorAtMs: 0,
  };
}

/**
 * Lowercase, strip everything that is not a letter, a digit or a space, and
 * collapse runs of space.
 *
 * Transcribe renders "step budget" and "step-budget" and "Step Budget" for the
 * same words depending on what came before them, and an anchor that only
 * matches one of those would light for some learners and not others. Padding
 * with a leading and trailing space lets a caller match on word boundaries
 * without a regular expression per anchor.
 */
export function normalise(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim()} `;
}

/**
 * Which of these anchors appear in this text.
 *
 * Matching is on whole words: " budget " matches "step budget runs out" and
 * not "budgeting". An anchor of several words matches only when those words
 * are adjacent, which is what makes "step budget" a different landmark from
 * "budget".
 */
export function anchorsHitIn(text: string, anchors: string[]): string[] {
  const haystack = normalise(text);
  return anchors.filter((anchor) => haystack.includes(normalise(anchor)));
}

export function paceStateFor(spentMs: number, beatSeconds: number): PaceState {
  const budgetMs = beatSeconds * 1000;
  if (spentMs >= budgetMs * OVERRUN_AT) return "overrun";
  if (spentMs >= budgetMs * STRETCHING_AT) return "stretching";
  return "on_budget";
}

export type Tick = {
  elapsedMs: number;
  /** The rolling partial transcript. Never rendered; see docs/07 section 3. */
  partialTranscript: string;
  /** True while the microphone is carrying a voice rather than a room. */
  voiced: boolean;
};

/**
 * One step of the engine.
 *
 * Returns a new state; the argument is not touched, so a replay can hold
 * every intermediate state and step backwards through them.
 */
export function advance(state: BeatState, tick: Tick): BeatState {
  const elapsedMs = Math.max(state.elapsedMs, tick.elapsedMs);
  const sinceLast = elapsedMs - state.elapsedMs;

  const beats = state.beats.map((beat) => ({ ...beat, hitAnchors: [...beat.hitAnchors] }));
  let lastAnchorAtMs = state.lastAnchorAtMs;

  // Anchors are checked on every beat, not only the current one, because a
  // learner who answers beat four while beat two is open is the case the
  // "you jumped past the constraint" nudge exists for.
  for (const beat of beats) {
    for (const anchor of anchorsHitIn(tick.partialTranscript, beat.anchors)) {
      if (beat.hitAnchors.includes(anchor)) continue;
      beat.hitAnchors.push(anchor);
      lastAnchorAtMs = elapsedMs;
      if (!beat.covered) {
        beat.covered = true;
        beat.coveredAtMs = elapsedMs;
      }
    }
  }

  // A beat is skipped once a later beat is covered while it is not.
  let seenCoveredLater = false;
  for (let index = beats.length - 1; index >= 0; index -= 1) {
    const beat = beats[index]!;
    if (!beat.covered && seenCoveredLater) beat.skipped = true;
    if (beat.covered) seenCoveredLater = true;
  }

  const currentIndex = beats.findIndex((beat) => !beat.covered);
  const current = currentIndex === -1 ? beats.length : currentIndex;

  // Time is charged to whichever beat was current across this interval, which
  // is the old current beat: a beat that just became covered still spent the
  // time it took to cover it.
  const charged = beats[state.currentIndex];
  if (charged && sinceLast > 0) charged.spentMs += sinceLast;

  for (const [index, beat] of beats.entries()) {
    if (beat.reachedAtMs === null && index <= current) beat.reachedAtMs = elapsedMs;
    beat.pace =
      beat.reachedAtMs === null ? "never_reached" : paceStateFor(beat.spentMs, beat.seconds);
  }

  return {
    beats,
    currentIndex: current,
    elapsedMs,
    lastVoiceAtMs: tick.voiced ? elapsedMs : state.lastVoiceAtMs,
    lastAnchorAtMs,
  };
}

/** The current beat, or null once every beat is covered. */
export function currentBeat(state: BeatState): BeatProgress | null {
  return state.beats[state.currentIndex] ?? null;
}

/** What the territory row draws: the current beat's anchors, and which of
 *  them have been said. Nothing from any other beat, because the row is a map
 *  of where the learner is, not of the whole answer. */
export function territory(state: BeatState): { term: string; hit: boolean }[] {
  const beat = currentBeat(state);
  if (!beat) return [];
  return beat.anchors.map((term) => ({ term, hit: beat.hitAnchors.includes(term) }));
}
