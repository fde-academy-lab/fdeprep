/**
 * Turn away anyone with no session before a page renders.
 *
 * This is a redirect, not the security boundary. Next's own guidance is that
 * proxy code runs separately from render code and may be pushed to a CDN, so
 * it does not read the database and does not verify the signature. It checks
 * that a cookie is present and nothing more.
 *
 * Verification happens in lib/session/current.ts, on the server, with the
 * database in reach. A forged cookie gets past here and is refused there,
 * which is the right split: this saves a render, that decides access.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE } from "./lib/auth/session.ts";

/** Reachable with no session: the sign-in screen and the OAuth round trip
 *  itself, or signing in would require being signed in. */
const OPEN = ["/signin", "/api/auth/"];

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  if (OPEN.some((prefix) => pathname === prefix || pathname.startsWith(prefix))) {
    return NextResponse.next();
  }
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();

  // A fetch cannot do anything with a redirect to an HTML page, so the two
  // answer differently. Both refuse.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { message: "Your session has ended. Sign in again to continue." }, { status: 401 });
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
