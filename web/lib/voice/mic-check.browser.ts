/**
 * The browser half of the microphone check: open the device, listen for five
 * seconds, hand what was heard to verdictFor.
 *
 * Kept apart from mic-check.ts so the decision can be tested without a
 * browser and this file stays thin enough to read in one go.
 */
import { MicrophoneUnavailable, startCapture } from "./capture.ts";
import { CHECK_SECONDS, verdictFor, type MicVerdict } from "./mic-check.ts";

export type CheckProgress = { elapsedMs: number; rms: number };

export async function runMicCheck(
  onProgress: (progress: CheckProgress) => void = () => {},
  seconds: number = CHECK_SECONDS,
): Promise<MicVerdict> {
  let frames = 0;
  let peakRms = 0;

  let capture;
  try {
    capture = await startCapture({
      onFrame: ({ rms }) => {
        frames += 1;
        if (rms > peakRms) peakRms = rms;
        onProgress({ elapsedMs: frames * 100, rms });
      },
    });
  } catch (error) {
    if (error instanceof MicrophoneUnavailable) {
      // An absent or blocked device never produced a frame, so the shape the
      // screen renders is the same as any other failure.
      return { ok: false, kind: "stalled", message: error.message, peakRms: 0, frames: 0 };
    }
    throw error;
  }

  try {
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    return verdictFor({
      trackMuted: capture.track.muted,
      trackEnabled: capture.track.enabled,
      frames,
      peakRms,
    });
  } finally {
    await capture.stop();
  }
}
