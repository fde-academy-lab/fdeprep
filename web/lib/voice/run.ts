/**
 * One answer's worth of cue and nudge state, in the order it happened.
 *
 * A thin, deliberately boring wrapper over the two pure modules: it holds the
 * accumulating state and the record of what fired, so a component has one
 * object to drive and one object to hand to the server at the end.
 *
 * It runs identically in all three modes. docs/07 section 4 is explicit that
 * unguided computes everything and draws none of it, because the replay in
 * the debrief is built from what would have fired. Whether a nudge reaches a
 * screen is the component's decision and is recorded as `wasShown`.
 */
import { advance, initialState, type Beat, type BeatProgress, type BeatState } from "./cues.ts";
import { firedKey, nextNudge, type Nudge } from "./nudges.ts";

export type VoiceMode = "guided" | "unguided" | "pressure";

export type RecordedNudge = Nudge & { beatKey: string | null; wasShown: boolean };

export type Tick = { elapsedMs: number; partialTranscript: string; voiced: boolean };

export class CockpitRun {
  private state: BeatState;
  private readonly fired = new Set<string>();
  private readonly nudges: RecordedNudge[] = [];
  private lastNudgeAt: number | null = null;

  constructor(
    private readonly beats: Beat[],
    private readonly totalSeconds: number,
    /** docs/07 section 4: the nudge slot exists in guided mode only. The
     *  engine still runs everywhere; this decides was_shown. */
    private readonly showsNudges: boolean,
  ) {
    this.state = initialState(beats);
  }

  get beatState(): BeatState {
    return this.state;
  }

  get recordedNudges(): readonly RecordedNudge[] {
    return this.nudges;
  }

  get beatResults(): readonly BeatProgress[] {
    return this.state.beats;
  }

  /** The nudge currently on screen, or null. One at a time, by construction:
   *  there is one slot and the newest line replaces whatever was in it. */
  get visibleNudge(): RecordedNudge | null {
    const last = this.nudges.at(-1);
    return last?.wasShown ? last : null;
  }

  /**
   * Advance to `tick.elapsedMs` and return the nudge that fired there, if any.
   *
   * `elapsedMs` is the answer's own clock, already net of any pressure-mode
   * interruption: docs/07 section 5 says the clock returns "with the
   * remaining time unchanged", so an interruption costs the learner their
   * composure and not their budget.
   */
  advanceTo(tick: Tick): RecordedNudge | null {
    this.state = advance(this.state, tick);

    const nudge = nextNudge(
      {
        elapsedMs: this.state.elapsedMs,
        beatState: this.state,
        partialTranscript: tick.partialTranscript,
        lastNudgeAt: this.lastNudgeAt,
      },
      { totalSeconds: this.totalSeconds, firedOnBeat: this.fired },
    );
    if (!nudge) return null;

    this.fired.add(firedKey(nudge, this.state.currentIndex));
    this.lastNudgeAt = nudge.atMs;
    const recorded: RecordedNudge = {
      ...nudge,
      beatKey: this.state.beats[this.state.currentIndex]?.key ?? null,
      wasShown: this.showsNudges,
    };
    this.nudges.push(recorded);
    return recorded;
  }

  /** What the server stores. Shapes match voice_beat_result and voice_nudge
   *  in docs/07 section 8. */
  timeline() {
    return {
      beats: this.state.beats.map((beat) => ({
        beatKey: beat.key,
        liveCovered: beat.covered,
        reachedAtMs: beat.reachedAtMs,
        spentMs: beat.spentMs,
        paceState: beat.pace,
      })),
      nudges: this.nudges.map((nudge) => ({
        atMs: nudge.atMs,
        kind: nudge.kind,
        line: nudge.line,
        wasShown: nudge.wasShown,
      })),
    };
  }
}

export type Timeline = ReturnType<CockpitRun["timeline"]>;
