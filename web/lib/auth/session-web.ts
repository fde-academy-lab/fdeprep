/**
 * The session cookie's signature, checked with the Web Crypto API alone.
 *
 * proxy.ts runs before every page and route, and turns away a request whose
 * cookie this does not accept. lib/auth/session.ts mints and reads the same
 * cookie with node:crypto on the server; this is the same reading written
 * against Web Crypto, which the Node.js runtime and the edge runtime both
 * provide, so the proxy can make the check wherever Next runs it. Next.js
 * 16.3.5 runs a proxy on Node.js only and does not let that be configured
 * (its version 16 upgrade guide, "middleware to proxy"), so this costs nothing
 * today and keeps working if that changes.
 *
 * Every route and page still reads the cookie through lib/session/current.ts,
 * which verifies it again and reads the enrolment from the database, and that
 * reading decides. This one saves a render and gives a forged cookie the
 * answer a missing one gets. tests/auth.test.ts holds the two readings to the
 * same verdict on every cookie it can think of.
 *
 * No database and no module state, because Next's guidance is that proxy code
 * may run apart from the rest of the application.
 */
export const SESSION_COOKIE = "fdeprep_session";

const encoder = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The bytes a base64url string encodes, or null when it is not one. */
function fromBase64url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/")
      .padEnd(Math.ceil(text.length / 4) * 4, "="));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

/**
 * Whether two strings are equal, in a time that depends on their length only.
 * The signature is compared against a value the caller supplies, the same
 * reason lib/auth/session.ts uses timingSafeEqual.
 */
function same(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

/**
 * The app_user id a cookie was signed for, or null when it was not signed with
 * this secret, does not parse, lacks the claim or has expired. A missing
 * secret verifies nothing, so every cookie is refused rather than trusted.
 */
export async function verifiedSessionUid(
  cookie: string | undefined,
  secret: string | undefined,
  nowS: number = Math.floor(Date.now() / 1000),
): Promise<number | null> {
  if (!cookie || !secret) return null;
  const parts = cookie.split(".");
  if (parts.length !== 2) return null;
  const [payload, signature] = parts as [string, string];

  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = base64url(new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(payload))));
  if (!same(expected, signature)) return null;

  const bytes = fromBase64url(payload);
  if (!bytes) return null;
  let claims: { uid?: unknown; exp?: unknown };
  try {
    claims = JSON.parse(new TextDecoder().decode(bytes)) as { uid?: unknown; exp?: unknown };
  } catch {
    return null;
  }
  if (typeof claims?.uid !== "number" || !Number.isInteger(claims.uid)) return null;
  if (typeof claims.exp !== "number" || claims.exp <= nowS) return null;
  return claims.uid;
}
