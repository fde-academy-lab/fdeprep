/**
 * Step one of the OAuth web flow: mint a state value and send the browser to
 * GitHub.
 *
 * The state is random, stored in an httpOnly cookie, and compared on the way
 * back. GitHub's own documentation calls it "an unguessable random string...
 * used to protect against cross-site request forgery attacks", and without the
 * comparison the callback will accept a code somebody else obtained.
 */
import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { authorizeUrl } from "@/lib/auth/github";
import { AuthNotConfigured, callbackUrl, githubClientId } from "@/lib/auth/config";

export const STATE_COOKIE = "fdeprep_oauth_state";
export const NEXT_COOKIE = "fdeprep_oauth_next";

/** The round trip to GitHub and back, generously. Long enough to read a
 *  two-factor prompt, short enough that a stale tab cannot be replayed. */
const STATE_TTL_S = 10 * 60;

export async function GET(request: Request): Promise<NextResponse> {
  let target: string;
  const state = randomBytes(32).toString("base64url");

  try {
    target = authorizeUrl({
      clientId: githubClientId(),
      redirectUri: callbackUrl(request.url),
      state,
    });
  } catch (error) {
    if (error instanceof AuthNotConfigured) {
      return NextResponse.redirect(new URL("/signin?error=not_configured", request.url));
    }
    throw error;
  }

  const response = NextResponse.redirect(target);
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    // Lax rather than Strict: the browser arrives back from github.com, and a
    // Strict cookie is not sent on that navigation, so the comparison would
    // fail for everybody.
    sameSite: "lax",
    secure: new URL(request.url).protocol === "https:",
    path: "/",
    maxAge: STATE_TTL_S,
  });

  // Where they were heading before being asked to sign in. A path, taken from
  // our own redirect, never a URL from the query string.
  const wanted = new URL(request.url).searchParams.get("next");
  if (wanted && wanted.startsWith("/") && !wanted.startsWith("//")) {
    response.cookies.set(NEXT_COOKIE, wanted, {
      httpOnly: true, sameSite: "lax", path: "/", maxAge: STATE_TTL_S,
      secure: new URL(request.url).protocol === "https:",
    });
  }
  return response;
}
