/**
 * The capture pipeline. docs/07 section 7.
 *
 * getUserMedia with echo cancellation and noise suppression, an AudioWorklet
 * downsampling to 16kHz mono PCM, frames every 100ms, and a MediaRecorder
 * copy kept separately for playback. The two copies exist for different
 * reasons: the PCM goes to the transcriber and is never stored, the recording
 * is stored and never transcribed.
 *
 * Browser only. Everything here touches window APIs.
 */

export const TARGET_SAMPLE_RATE = 16_000;
export const FRAME_MS = 100;
export const FRAME_SAMPLES = (TARGET_SAMPLE_RATE * FRAME_MS) / 1000;

export const WORKLET_URL = "/voice/pcm-worklet.js";

export type CaptureFrame = { pcm: Int16Array; rms: number };

export type CaptureOptions = {
  onFrame: (frame: CaptureFrame) => void;
  /** Keep a MediaRecorder copy for playback. Off for the microphone check,
   *  which has nothing worth playing back. */
  record?: boolean;
};

export type Capture = {
  /** The rate the AudioContext actually gave us, which is not always the one
   *  asked for. Worth surfacing because it decides whether the worklet is
   *  converting or resampling. */
  contextSampleRate: number;
  track: MediaStreamTrack;
  stop: () => Promise<Blob | null>;
};

export class MicrophoneUnavailable extends Error {
  constructor(
    message: string,
    readonly kind: "denied" | "absent" | "failed",
  ) {
    super(message);
  }
}

/** Chromium and Firefox take a sampleRate hint on the constructor and Safari
 *  has historically ignored it, so the worklet is told the truth either way
 *  and resamples when it has to. */
function audioContext(): AudioContext {
  try {
    return new AudioContext({ sampleRate: TARGET_SAMPLE_RATE, latencyHint: "interactive" });
  } catch {
    return new AudioContext({ latencyHint: "interactive" });
  }
}

async function microphone(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new MicrophoneUnavailable(
      "This browser cannot reach a microphone. Use Chrome, Firefox or Safari over HTTPS.",
      "absent",
    );
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
      video: false,
    });
  } catch (error) {
    const name = (error as { name?: string }).name ?? "";
    if (name === "NotAllowedError" || name === "SecurityError") {
      throw new MicrophoneUnavailable(
        "The browser blocked the microphone. Allow it for this site in the address bar, " +
          "then run the check again.",
        "denied",
      );
    }
    if (name === "NotFoundError" || name === "OverconstrainedError") {
      throw new MicrophoneUnavailable(
        "No microphone was found. Plug one in or pick one in your system sound settings, " +
          "then run the check again.",
        "absent",
      );
    }
    throw new MicrophoneUnavailable(
      `The microphone could not be opened (${name || "unknown error"}). ` +
        "Close any other tab or application using it, then run the check again.",
      "failed",
    );
  }
}

export async function startCapture(options: CaptureOptions): Promise<Capture> {
  const stream = await microphone();
  const track = stream.getAudioTracks()[0];
  if (!track) {
    stream.getTracks().forEach((t) => t.stop());
    throw new MicrophoneUnavailable("The microphone opened with no audio track.", "failed");
  }

  const context = audioContext();
  await context.audioWorklet.addModule(WORKLET_URL);
  if (context.state === "suspended") await context.resume();

  const node = new AudioWorkletNode(context, "pcm-downsampler", {
    numberOfInputs: 1,
    numberOfOutputs: 0,
    processorOptions: { targetRate: TARGET_SAMPLE_RATE, frameSamples: FRAME_SAMPLES },
  });
  node.port.onmessage = (event: MessageEvent<CaptureFrame>) => options.onFrame(event.data);
  context.createMediaStreamSource(stream).connect(node);

  let recorder: MediaRecorder | null = null;
  const chunks: Blob[] = [];
  if (options.record && typeof MediaRecorder !== "undefined") {
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.start(1000);
  }

  return {
    contextSampleRate: context.sampleRate,
    track,
    async stop() {
      node.port.onmessage = null;
      node.disconnect();
      const recording = await new Promise<Blob | null>((resolve) => {
        if (!recorder || recorder.state === "inactive") return resolve(null);
        recorder.onstop = () => resolve(new Blob(chunks, { type: recorder!.mimeType }));
        recorder.stop();
      });
      stream.getTracks().forEach((t) => t.stop());
      await context.close();
      return recording;
    },
  };
}

/** Base64 for a frame, without Buffer, which the browser does not have. */
export function encodePcm(frame: Int16Array): string {
  const bytes = new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength);
  let binary = "";
  // In chunks, because a spread of 3,200 arguments into fromCharCode is fine
  // and a spread of a whole answer is not.
  for (let i = 0; i < bytes.length; i += 1024) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 1024));
  }
  return btoa(binary);
}
