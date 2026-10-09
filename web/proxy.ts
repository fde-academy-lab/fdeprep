/**
 * Turn away anyone without a verified session before a page renders.
 *
 * The proxy checks the cookie's signature and expiry with Web Crypto and the
 * signing secret (lib/auth/session-web.ts), so a forged or expired cookie
 * gets exactly what a missing one gets: a redirect to sign in for a page, a
 * 401 for an API call. Until 8 October 2026 it checked only that a cookie with
 * the right name existed, and two routes took that as enough (S15.13).
 *
 * The routes hold the boundary. Next's guidance is that proxy code may run
 * apart from the rest of the application, so this file reads no database: it
 * cannot know whether the enrolment is still active or whose record a route is
 * about to read. Every route and page verifies the cookie again through
 * lib/session/current.ts and checks who may read the record it loads
 * (lib/session/records.ts). tests/route-sessions.test.ts fails on any API
 * route that leaves that to this file.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifiedSessionUid } from "./lib/auth/session-web.ts";
import { devLearnerEnabled } from "./lib/auth/config.ts";
import { SIGNED_OUT } from "./lib/http/failure.ts";

/** Reachable with no session: the sign-in screen and the OAuth round trip
 *  itself, or signing in would require being signed in. */
// The invite page is open because the person holding the link has not
// signed in yet; it says whether the link is still good and nothing more.
const OPEN = ["/signin", "/api/auth/", "/invite/"];

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  if (OPEN.some((prefix) => pathname === prefix || pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  // The secret is read from the environment on every request, as
  // lib/auth/config.ts reads it, and a deployment without one verifies nothing.
  const cookie = request.cookies.get(SESSION_COOKIE)?.value;
  if (await verifiedSessionUid(cookie, process.env.AUTH_SECRET) !== null) return NextResponse.next();

  // A laptop running without a GitHub application has no cookie to present and
  // never will, so turning it away here would leave every screen shut with no
  // way to open one. lib/auth/config.ts refuses this whenever a GitHub
  // application is configured or NODE_ENV is production, and it reads only the
  // environment, which the proxy may do.
  if (devLearnerEnabled()) return NextResponse.next();

  // A fetch cannot do anything with a redirect to an HTML page, so the two
  // answer differently. Both refuse.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ message: SIGNED_OUT }, { status: 401 });
  }

  const signin = new URL("/signin", request.url);
  // Where to put them back once they are in. Path only, never a full URL from
  // the request, because an absolute value here is an open redirect.
  if (pathname !== "/") signin.searchParams.set("next", pathname);
  return NextResponse.redirect(signin);
}

export const config = {
  // Everything except Next's own assets and the favicon. The sign-in screen
  // and the OAuth routes are allowed through in the handler rather than here,
  // so the list of what is open lives in one place.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
