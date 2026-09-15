/**
 * The voice socket wire protocol.
 *
 * Both ends of the socket share this file: the browser sends ClientMessage and
 * reads ServerMessage, the Lambda does the reverse. Keeping one definition is
 * the point, because a protocol written twice drifts on the first change.
 *
 * Audio travels as base64 inside a JSON envelope rather than as a binary
 * frame. API Gateway hands a WebSocket message to Lambda as a string either
 * way, so a binary frame would be base64 by the time the handler saw it, and
 * one encoding is easier to reason about than two.
 *
 * The message types are shared with the browser and erase at compile time.
 * The two codec helpers at the bottom are Node-side only, because they use
 * Buffer; the browser has its own encoder in capture.ts.
 */

/** Verified 2026-09-15 against the API Gateway quotas table in the AWS
 *  General Reference: WebSocket frame size 32 KB, message payload 128 KB,
 *  neither adjustable. A 100ms frame of 16kHz mono 16-bit PCM is 3,200 bytes,
 *  which is 4,268 base64 characters inside an envelope of about 40, so one
 *  frame per message sits an order of magnitude inside the frame limit. */
export const FRAME_LIMIT_BYTES = 32 * 1024;

export type ClientMessage =
  | { t: "audio"; seq: number; pcm: string }
  | { t: "stop" };

export type ServerMessage =
  | { t: "ready"; sessionId: string; sampleRate: number }
  | { t: "partial"; text: string; startMs: number }
  | { t: "final"; text: string; startMs: number; endMs: number }
  | { t: "closed"; reason: CloseReason; transcript: string; frames: number }
  | { t: "error"; code: ErrorCode; message: string };

export type CloseReason = "stopped" | "idle" | "ceiling" | "client_gone" | "failed";

export type ErrorCode =
  | "bad_token"
  | "no_consent"
  | "bad_message"
  | "frame_too_large"
  | "stt_failed";

/**
 * Parse a client message without trusting any of it.
 *
 * `.claude/rules/01-trust-boundaries.md`: client input is never authoritative.
 * The browser may not name a sample rate, a session, a language or a storage
 * path; every one of those is resolved server-side from the signed token. So
 * this accepts audio and stop, and nothing else, and returns null rather than
 * throwing so the caller decides what a bad message costs.
 */
export function parseClientMessage(raw: string): ClientMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const message = value as Record<string, unknown>;

  if (message.t === "stop") return { t: "stop" };
  if (message.t !== "audio") return null;
  if (typeof message.pcm !== "string" || message.pcm.length === 0) return null;
  if (typeof message.seq !== "number" || !Number.isInteger(message.seq) || message.seq < 0) {
    return null;
  }
  return { t: "audio", seq: message.seq, pcm: message.pcm };
}

/** Decode one audio frame to the Int16Array the adapter takes. Returns null
 *  when the payload is not a whole number of 16-bit samples, which is the
 *  shape Amazon Transcribe rejects: its own guidance is that single-channel
 *  PCM chunks hold an even number of bytes. */
export function decodeFrame(pcm: string): Int16Array | null {
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(Buffer.from(pcm, "base64"));
  } catch {
    return null;
  }
  if (bytes.length === 0 || bytes.length % 2 !== 0) return null;
  return new Int16Array(bytes.buffer, bytes.byteOffset, bytes.length / 2);
}

export function encodeFrame(samples: Int16Array): string {
  return Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength).toString("base64");
}
