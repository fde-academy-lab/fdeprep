/**
 * Everything the socket resolves for itself.
 *
 * `.claude/rules/01-trust-boundaries.md`: the browser may not supply a sample
 * rate, a language, a model, a storage path or an allowance. Each of those is
 * read here, from the environment, on the server.
 */

/**
 * API Gateway WebSocket quotas, verified 2026-09-15 against the Amazon API
 * Gateway service quotas table in the AWS General Reference:
 *
 *   WebSocket Idle Connection Timeout      600 seconds     not adjustable
 *   Connection duration for WebSocket API  7,200 seconds   not adjustable
 *   WebSocket frame size                   32 KB           not adjustable
 *   WebSocket message payload size         128 KB          not adjustable
 *
 * docs/07 section 7 asks for an idle timeout below the platform maximum so an
 * abandoned session cannot hold a connection open. Both ceilings below are
 * enforced by this application, and both sit under the platform's, so the
 * socket always closes on our terms and with a reason the learner can read.
 */
export const PLATFORM_IDLE_TIMEOUT_MS = 600_000;
export const PLATFORM_CONNECTION_MAX_MS = 7_200_000;

/** No audio for two minutes means the learner walked away. Well under the
 *  platform's ten, and far longer than any pause inside a real answer: the
 *  longest silence the debrief reports is measured in seconds. */
export const IDLE_TIMEOUT_MS = 120_000;

/** A hard ceiling on one sitting. The longest authored question in docs/07 is
 *  285 seconds, so fifteen minutes covers a slow start, a pressure follow-up
 *  and a debrief that has not begun, and still closes long before the
 *  platform's two hours. */
export const SESSION_CEILING_MS = 900_000;

/** docs/07 section 7: 16kHz mono PCM, frames every 100ms. Amazon Transcribe
 *  accepts 8,000 to 48,000 Hz and its own guidance recommends 16,000 as the
 *  best compromise between quality and bytes on the wire, and a chunk between
 *  50ms and 200ms. Both numbers land inside both recommendations. */
export const SAMPLE_RATE = 16_000;
export const FRAME_MS = 100;

/** 0.1s x 16,000 samples x 2 bytes. Amazon Transcribe's own formula, and its
 *  requirement that a single-channel PCM chunk hold an even number of bytes. */
export const FRAME_BYTES = (FRAME_MS / 1000) * SAMPLE_RATE * 2;

export type SttChoice = "transcribe" | "scripted";

export type VoiceConfig = {
  stt: SttChoice;
  region: string;
  language: string;
  sampleRate: number;
  /**
   * Partial-result stabilization, off by default.
   *
   * Amazon Transcribe's documentation says stabilization "can reduce latency
   * in your output, but may impact accuracy". The live cues are substring
   * matches against beat anchors and a matched anchor stays matched, so cue
   * state tolerates churn in the partials. The final transcript is what the
   * rubric judge scores, and trading its accuracy for a smoother cue is the
   * wrong way round. Phase 8 measures this on real audio and can turn it on.
   */
  stabilizePartials: boolean;
  /**
   * Minutes during which a Transcribe session can be resumed by session id,
   * measured from the stream start. The documented range is 1 to 300.
   *
   * The Lambda path opens one Transcribe stream per batch of frames rather
   * than one per answer, because API Gateway invokes a Lambda per message and
   * no invocation spans the answer. Passing the same SessionId inside this
   * window is what makes those reconnects one transcription rather than a
   * dozen cold starts that cut words at every boundary.
   */
  resumeWindowMinutes: number;
};

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value)) throw new Error(`${name} must be a whole number, got "${raw}".`);
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): VoiceConfig {
  const stt = env.VOICE_STT ?? "transcribe";
  if (stt !== "transcribe" && stt !== "scripted") {
    throw new Error(`VOICE_STT must be "transcribe" or "scripted", got "${stt}".`);
  }
  const resumeWindowMinutes = envInt("VOICE_RESUME_WINDOW_MINUTES", 20);
  if (resumeWindowMinutes < 1 || resumeWindowMinutes > 300) {
    throw new Error(
      `VOICE_RESUME_WINDOW_MINUTES must be between 1 and 300, got ${resumeWindowMinutes}. ` +
        "Amazon Transcribe rejects anything outside that range.",
    );
  }
  return {
    stt,
    region: env.AWS_REGION ?? "eu-west-1",
    language: env.VOICE_LANGUAGE ?? "en-US",
    sampleRate: SAMPLE_RATE,
    stabilizePartials: env.VOICE_STABILIZE_PARTIALS === "1",
    resumeWindowMinutes,
  };
}
