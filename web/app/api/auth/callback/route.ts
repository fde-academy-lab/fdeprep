/**
 * Step two: GitHub sends the browser back here with a code.
 *
 * Order matters and it is the order docs/01 S1 gives. Compare the state, trade
 * the code for a token, ask who they are, ask whether they are in the
 * organisation, then look for a roster row. A refusal at any point sends them
 * back to the sign-in screen with the reason, and the three reasons have three
 * different owners.
 *
 * The GitHub access token lives in this function and nowhere else. It is used
 * twice and dropped.
 */
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { exchangeCode, fetchViewer, isActiveOrgMember, GithubRejected } from "@/lib/auth/github";
import { resolveAccess } from "@/lib/auth/access";
import { SESSION_COOKIE, SESSION_TTL_S, mintSession } from "@/lib/auth/session";
import {
  AuthNotConfigured, authSecret, callbackUrl, githubClientId, githubClientSecret, githubOrg,
} from "@/lib/auth/config";
import { NEXT_COOKIE, STATE_COOKIE } from "../start/route";

function backToSignIn(request: Request, error: string): NextResponse {
  const url = new URL("/signin", request.url);
  url.searchParams.set("error", error);
  const response = NextResponse.redirect(url);
  response.cookies.delete(STATE_COOKIE);
  response.cookies.delete(NEXT_COOKIE);
  return response;
}

function statesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  // The learner pressed Cancel on GitHub's screen. Not an error worth a page.
  if (url.searchParams.get("error")) return backToSignIn(request, "cancelled");

  const expected = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${STATE_COOKIE}=`))
    ?.slice(STATE_COOKIE.length + 1);

  if (!code || !state || !expected || !statesMatch(state, expected)) {
    return backToSignIn(request, "bad_state");
  }

  let access: Awaited<ReturnType<typeof resolveAccess>>;
  try {
    const token = await exchangeCode({
      code,
      clientId: githubClientId(),
      clientSecret: githubClientSecret(),
      redirectUri: callbackUrl(request.url),
    });
    const [viewer, member] = await Promise.all([
      fetchViewer(token),
      isActiveOrgMember(token, githubOrg()),
    ]);
    access = await resolveAccess(viewer, member);
  } catch (error) {
    if (error instanceof AuthNotConfigured) return backToSignIn(request, "not_configured");
    if (error instanceof GithubRejected) return backToSignIn(request, "github_refused");
    throw error;
  }

  if (!access.ok) return backToSignIn(request, access.reason);

  const wanted = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${NEXT_COOKIE}=`))
    ?.slice(NEXT_COOKIE.length + 1);
  const destination = wanted && wanted.startsWith("/") && !wanted.startsWith("//") ? wanted : "/";

  const response = NextResponse.redirect(new URL(destination, request.url));
  response.cookies.set(SESSION_COOKIE, mintSession({ uid: access.userId }, authSecret()), {
    httpOnly: true,
    sameSite: "lax",
    secure: url.protocol === "https:",
    path: "/",
    maxAge: SESSION_TTL_S,
  });
  response.cookies.delete(STATE_COOKIE);
  response.cookies.delete(NEXT_COOKIE);
  return response;
}
