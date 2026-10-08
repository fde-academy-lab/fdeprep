/**
 * One reply to a follow-up round: the sixty second clock and the one nudge
 * slot. docs/07 section 5a.
 *
 * The reply's instruments are fewer than the main answer's five: the clock,
 * the microphone level and the nudge slot, and a Done button. This holds the
 * clock and the nudge, the same way lib/voice/run.ts holds the main answer's,
 * so the component draws state and decides nothing. It imports nothing, so it
 * can reach no network: no model call happens while the learner replies, and
 * tests/cockpit.test.ts runs a whole reply with fetch refused to prove it.
 *
 * Browser-safe.
 */

/** docs/07 section 5: sixty seconds, like an interruption. */
export const REPLY_SECONDS = 60;

/** docs/07 section 3's nudge table, the two lines that apply to a reply. */
export const REPLY_NUDGES = {
  silence: "Say the next step out loud.",
  closing: "Close it now.",
} as const;

const SILENCE_MS = 5_000;
const CLOSING_MS = 15_000;
/** docs/07 section 3: never inside twenty seconds of the last nudge. */
const NUDGE_GAP_MS = 20_000;

export type ReplyTick = { elapsedMs: number; voiced: boolean };
export type ReplyState = {
  remainingMs: number;
  /** The nudge that fired on this tick, or null. */
  nudge: string | null;
  /** The clock ran out, so the reply ends. */
  over: boolean;
};

export class ReplyRun {
  private lastVoicedAt = 0;
  private lastNudgeAt: number | null = null;
  private closingSaid = false;
  private readonly fired: Array<{ atMs: number; line: string }> = [];

  constructor(private readonly seconds: number = REPLY_SECONDS) {}

  get nudges(): ReadonlyArray<{ atMs: number; line: string }> {
    return this.fired;
  }

  advanceTo(tick: ReplyTick): ReplyState {
    const totalMs = this.seconds * 1000;
    const remainingMs = Math.max(0, totalMs - tick.elapsedMs);
    if (tick.voiced) this.lastVoicedAt = tick.elapsedMs;

    let nudge: string | null = null;
    const quiet = this.lastNudgeAt === null || tick.elapsedMs - this.lastNudgeAt >= NUDGE_GAP_MS;
    if (quiet && remainingMs > 0) {
      if (!this.closingSaid && remainingMs <= CLOSING_MS) {
        nudge = REPLY_NUDGES.closing;
        this.closingSaid = true;
      } else if (tick.elapsedMs - this.lastVoicedAt >= SILENCE_MS) {
        nudge = REPLY_NUDGES.silence;
      }
    }
    if (nudge) {
      this.lastNudgeAt = tick.elapsedMs;
      this.fired.push({ atMs: tick.elapsedMs, line: nudge });
    }
    return { remainingMs, nudge, over: remainingMs === 0 };
  }
}
