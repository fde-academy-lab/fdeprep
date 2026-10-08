/**
 * The voice socket's two settings, read where a token is minted: when a
 * session opens, and when an interview round hands the browser its own
 * connection (docs/07 section 5a).
 */
export class VoiceNotConfigured extends Error {
  readonly status = 503;
}

export function socketUrl(): string {
  const url = process.env.VOICE_SOCKET_URL;
  if (!url) {
    throw new VoiceNotConfigured(
      "The voice socket is not configured. Set VOICE_SOCKET_URL to the WebSocket endpoint " +
        "before opening a session.",
    );
  }
  return url;
}

export function tokenSecret(): string {
  const value = process.env.VOICE_TOKEN_SECRET;
  if (!value) {
    throw new VoiceNotConfigured(
      "The voice socket is not configured. Set VOICE_TOKEN_SECRET to the same value the " +
        "authorizer holds before opening a session.",
    );
  }
  return value;
}

/** docs/07 section 7: 16kHz mono PCM. */
export const SAMPLE_RATE = 16_000;
