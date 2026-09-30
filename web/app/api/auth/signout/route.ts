/**
 * Drop the cookie.
 *
 * POST rather than GET, so a link or an image somebody else controls cannot
 * sign a learner out mid-attempt.
 */
import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { publicUrl } from "@/lib/http/public-url";

export async function POST(request: Request): Promise<NextResponse> {
  const response = NextResponse.redirect(publicUrl("/signin?error=signed_out", request.url), 303);
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
