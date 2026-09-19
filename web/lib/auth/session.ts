/**
 * The signed cookie that says who is asking.
 *
 * Same shape as lib/voice/token.ts and for the same reason: an HMAC over a
 * compact JSON payload needs a shared secret and nothing else to verify.
 *
 * It carries one claim, the app_user id. Role, persona, cohort and enrolment
 * are read from the database on every request, so there is nothing in the
 * cookie worth forging beyond being somebody else, which the signature stops.
 * .claude/rules/01: client input is never authoritative.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "fdeprep_session";

/**
 * Twelve hours. Long enough that nobody signs in twice in a working day, short
 * enough that removing somebody from the GitHub organisation reaches them
 * inside one. Organisation membership is checked at sign-in, so a longer
 * session is a longer window in which an offboarded learner still has a live
 * cookie.
 */
export const SESSION_TTL_S = 12 * 60 * 60;

export interface SessionClaims {
  /** app_user.id */
  uid: number;
  /** Unix seconds. */
  exp: number;
}

export class SessionRejected extends Error {}

function b64url(input: Buffer): string {
  return input.toString("base64url");
}

function sign(payload: string, secret: string): string {
  return b64url(createHmac("sha256", secret).update(payload).digest());
}

export function mintSession(
  claims: Omit<SessionClaims, "exp">,
  secret: string,
  nowS: number = Math.floor(Date.now() / 1000),
): string {
  if (!secret) throw new SessionRejected("AUTH_SECRET is not set.");
  const payload = b64url(Buffer.from(JSON.stringify({ ...claims, exp: nowS + SESSION_TTL_S })));
  return `${payload}.${sign(payload, secret)}`;
}

/**
 * Verify and decode, or throw.
 *
 * timingSafeEqual rather than ===, because the comparison is against a value
 * the caller supplies and controls the length of. Length is checked first,
 * since timingSafeEqual throws on a mismatch.
 */
export function readSession(
  cookie: string,
  secret: string,
  nowS: number = Math.floor(Date.now() / 1000),
): SessionClaims {
  if (!secret) throw new SessionRejected("AUTH_SECRET is not set.");
  const parts = cookie.split(".");
  if (parts.length !== 2) throw new SessionRejected("That session cookie is malformed.");
  const [payload, signature] = parts as [string, string];

  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    throw new SessionRejected("That session cookie is not signed by this application.");
  }

  let claims: SessionClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SessionClaims;
  } catch {
    throw new SessionRejected("That session cookie is malformed.");
  }
  if (typeof claims.uid !== "number" || !Number.isInteger(claims.uid)) {
    throw new SessionRejected("That session cookie is missing a claim.");
  }
  if (typeof claims.exp !== "number" || claims.exp <= nowS) {
    throw new SessionRejected("Your session has expired. Sign in again.");
  }
  return claims;
}
