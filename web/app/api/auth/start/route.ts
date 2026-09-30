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
import { AuthNotConfigured, callbackUrl, githubClientId, oauthScope } from "@/lib/auth/config";
import { TOKEN_SHAPE } from "@/lib/auth/invite";
import { publicUrl, servedOverHttps } from "@/lib/http/public-url";

export const STATE_COOKIE = "fdeprep_oauth_state";
export const NEXT_COOKIE = "fdeprep_oauth_next";
/** An invite link's token, carried through GitHub to the callback. */
export const INVITE_COOKIE = "fdeprep_invite";

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
      scope: oauthScope(),
    });
  } catch (error) {
    if (error instanceof AuthNotConfigured) {
      return NextResponse.redirect(publicUrl("/signin?error=not_configured", request.url));
    }
    throw error;
  }

  const secure = servedOverHttps(request.url);
  const response = NextResponse.redirect(target);
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    // Lax rather than Strict: the browser arrives back from github.com, and a
    // Strict cookie is not sent on that navigation, so the comparison would
    // fail for everybody.
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: STATE_TTL_S,
  });

  const query = new URL(request.url).searchParams;

  // Where they were heading before being asked to sign in. A path, taken from
  // our own redirect, never a URL from the query string.
  const wanted = query.get("next");
  if (wanted && wanted.startsWith("/") && !wanted.startsWith("//")) {
    response.cookies.set(NEXT_COOKIE, wanted, {
      httpOnly: true, sameSite: "lax", path: "/", maxAge: STATE_TTL_S, secure,
    });
  }

  // The invite rides through GitHub in a cookie rather than in the state, so
  // it never appears in a URL GitHub logs. Anything that is not the shape of
  // a token we issue is dropped here rather than looked up.
  const invite = query.get("invite");
  if (invite && TOKEN_SHAPE.test(invite)) {
    response.cookies.set(INVITE_COOKIE, invite, {
      httpOnly: true, sameSite: "lax", path: "/", maxAge: STATE_TTL_S, secure,
    });
  }
  return response;
}
