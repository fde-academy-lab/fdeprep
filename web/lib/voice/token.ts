/**
 * The short-lived session token the browser presents on connect.
 *
 * docs/07 section 7: "The browser never holds AWS credentials. The application
 * mints a short-lived signed session token that the socket presents on
 * connect." This is that token. It is an HMAC over a compact JSON payload, so
 * verifying it needs a shared secret and nothing else, which matters because
 * the verifier is a Lambda authorizer with no database connection.
 *
 * What it carries is what the socket is allowed to assume: which enrolment,
 * which voice session, which mode. Everything else the socket needs, it
 * resolves itself. The browser supplying any of these directly would make the
 * caps and the consent gate advisory.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** Long enough to survive a slow handshake, short enough that a leaked token
 *  from a shared screen is worthless by the time anyone reads it. */
export const TOKEN_TTL_S = 60;

export type VoiceTokenClaims = {
  /** voice_session.id, as text. */
  sid: string;
  /** enrolment.id. */
  eid: number;
  /** voice_question.id. */
  qid: number;
  mode: "guided" | "unguided" | "pressure";
  /** Unix seconds. */
  exp: number;
};

export class TokenRejected extends Error {}

function b64url(input: Buffer): string {
  return input.toString("base64url");
}

function sign(payload: string, secret: string): string {
  return b64url(createHmac("sha256", secret).update(payload).digest());
}

export function mintVoiceToken(
  claims: Omit<VoiceTokenClaims, "exp">,
  secret: string,
  nowS: number = Math.floor(Date.now() / 1000),
): string {
  if (!secret) throw new TokenRejected("VOICE_TOKEN_SECRET is not set.");
  const payload = b64url(Buffer.from(JSON.stringify({ ...claims, exp: nowS + TOKEN_TTL_S })));
  return `${payload}.${sign(payload, secret)}`;
}

/**
 * Verify and decode, or throw.
 *
 * The signature is compared with timingSafeEqual rather than ===, because the
 * comparison is against a value an attacker supplies and controls the length
 * of. Length is checked first, since timingSafeEqual throws on a mismatch.
 */
export function readVoiceToken(
  token: string,
  secret: string,
  nowS: number = Math.floor(Date.now() / 1000),
): VoiceTokenClaims {
  if (!secret) throw new TokenRejected("VOICE_TOKEN_SECRET is not set.");
  const parts = token.split(".");
  if (parts.length !== 2) throw new TokenRejected("That session token is malformed.");
  const [payload, signature] = parts as [string, string];

  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    throw new TokenRejected("That session token is not signed by this application.");
  }

  let claims: VoiceTokenClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as VoiceTokenClaims;
  } catch {
    throw new TokenRejected("That session token is malformed.");
  }
  if (typeof claims.exp !== "number" || claims.exp <= nowS) {
    throw new TokenRejected("That session token has expired. Start the session again.");
  }
  if (typeof claims.sid !== "string" || typeof claims.eid !== "number") {
    throw new TokenRejected("That session token is missing a claim.");
  }
  return claims;
}
