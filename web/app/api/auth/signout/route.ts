/**
 * Drop the cookie.
 *
 * POST rather than GET, so a link or an image somebody else controls cannot
 * sign a learner out mid-attempt.
 */
import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session";

export async function POST(request: Request): Promise<NextResponse> {
  const response = NextResponse.redirect(new URL("/signin?error=signed_out", request.url), 303);
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
