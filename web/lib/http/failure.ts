/**
 * What a JSON route answers when it cannot do its job.
 *
 * A route that rethrows hands the browser Next's own error page, which is HTML
 * with no message, and the screen that called it can say nothing useful. A
 * route that calls currentLearner() redirects a signed-out fetch to the
 * sign-in page, which a fetch follows and then cannot read either. The voice
 * routes answer through these three instead, so every reply the cockpit, the
 * typed answer and the debrief controls read is JSON with a sentence that
 * names the next action.
 *
 * The cause goes to the server log and never to the learner. It can carry a
 * table, a bucket or a host name, and a learner can do nothing with any of
 * them.
 */
import { NextResponse } from "next/server";

/** One sentence for a request with no session that verifies, wherever it is refused. */
export const SIGNED_OUT = "Your session has ended. Sign in again to continue.";

/**
 * The proxy's own answer to an API call with no verified session, so a route
 * that refuses a forged cookie answers exactly as the proxy does.
 */
export function signedOut(): NextResponse {
  return NextResponse.json({ message: SIGNED_OUT }, { status: 401 });
}

/** Logs what failed and where, and answers 500 with the learner's sentence. */
export function unexpected(where: string, error: unknown, message: string): NextResponse {
  console.error(`${where} failed:`, error);
  return NextResponse.json({ message }, { status: 500 });
}

/** The request body as JSON, or null when it is not JSON, so a malformed body
 *  is the caller's 400 rather than a SyntaxError and a 500. */
export async function jsonBody<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}
