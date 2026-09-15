/**
 * The Transcribe session id, derived rather than stored.
 *
 * The Lambda path opens one Transcribe stream per batch of frames, and every
 * batch of one answer has to present the same SessionId or Transcribe treats
 * each as a fresh transcription and the words at each boundary suffer. The
 * obvious way to keep that id is a table keyed by connection, which would put
 * a database write in front of every audio frame.
 *
 * Deriving it from the connection id instead removes the table: the same
 * connection always hashes to the same UUID, a different connection never
 * collides with it, and nothing has to be read back. API Gateway's connection
 * ids are unguessable and this is not a secret in any case, because holding
 * it grants nothing without the socket.
 */
import { createHash } from "node:crypto";

/** Distinguishes these ids from any other use of the same hash. */
const NAMESPACE = "fdeprep.voice.stt-session.v1";

/**
 * A UUID in the shape Amazon Transcribe's SessionId requires: 36 characters
 * matching `[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}`.
 * Version and variant bits are set so the value is a well-formed UUID rather
 * than 32 hex characters with dashes in it.
 */
export function sttSessionIdFor(connectionId: string): string {
  const digest = createHash("sha256").update(`${NAMESPACE}:${connectionId}`).digest();
  const bytes = Uint8Array.prototype.slice.call(digest, 0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const hex = Buffer.from(bytes).toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}
