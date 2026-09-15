/**
 * The five second pre-flight. docs/07 section 7 and section 12 item 2.
 *
 * "A learner who discovers their microphone is muted at 0:40 has lost the
 * attempt." So the check refuses the session rather than warning about it,
 * and every refusal names the thing to go and do.
 *
 * The verdict is separated from the browser plumbing on purpose: the decision
 * is the part worth testing, and it needs no microphone to test.
 */

export const CHECK_SECONDS = 5;

/** A frame peak under this is silence. Speech at a normal level peaks well
 *  above it; a room with noise suppression on sits well below. */
export const HEARD_RMS = 0.01;

/** Frames expected in five seconds at 100ms each, less a generous allowance
 *  for a slow start. Far fewer than this means the pipeline is broken rather
 *  than the room being quiet. */
export const MIN_FRAMES = 20;

export type MicVerdict =
  | { ok: true; peakRms: number; frames: number }
  | {
      ok: false;
      kind: "muted" | "silent" | "stalled";
      message: string;
      peakRms: number;
      frames: number;
    };

export function verdictFor(input: {
  trackMuted: boolean;
  trackEnabled: boolean;
  frames: number;
  peakRms: number;
}): MicVerdict {
  const { frames, peakRms } = input;

  if (input.trackMuted || !input.trackEnabled) {
    return {
      ok: false,
      kind: "muted",
      message:
        "The microphone is muted. Unmute it in your system sound settings, or on the " +
        "hardware switch if your headset has one, then run the check again.",
      peakRms,
      frames,
    };
  }

  if (frames < MIN_FRAMES) {
    return {
      ok: false,
      kind: "stalled",
      message:
        `Only ${frames} of about ${(CHECK_SECONDS * 1000) / 100} audio frames arrived in ` +
        `${CHECK_SECONDS} seconds. Close any other tab or application using the microphone, ` +
        "then run the check again.",
      peakRms,
      frames,
    };
  }

  if (peakRms < HEARD_RMS) {
    return {
      ok: false,
      kind: "silent",
      message:
        "The microphone is open but nothing was heard. Check that the right input device is " +
        "selected and speak while the check runs, then run it again.",
      peakRms,
      frames,
    };
  }

  return { ok: true, peakRms, frames };
}

/** Whether a session may start. One place, so a screen cannot decide for
 *  itself that a warning is good enough. */
export function passesCheck(verdict: MicVerdict | null): boolean {
  return verdict !== null && verdict.ok;
}
