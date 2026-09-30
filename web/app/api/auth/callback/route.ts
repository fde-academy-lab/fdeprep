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
  orgCheckRequired,
} from "@/lib/auth/config";
import { publicUrl, servedOverHttps } from "@/lib/http/public-url";
import { INVITE_COOKIE, NEXT_COOKIE, STATE_COOKIE } from "../start/route";

function backToSignIn(request: Request, error: string): NextResponse {
  const url = publicUrl("/signin", request.url);
  url.searchParams.set("error", error);
  const response = NextResponse.redirect(url);
  clearRoundTrip(response);
  return response;
}

/** Every cookie the round trip set, spent or not. */
function clearRoundTrip(response: NextResponse): void {
  response.cookies.delete(STATE_COOKIE);
  response.cookies.delete(NEXT_COOKIE);
  response.cookies.delete(INVITE_COOKIE);
}

function readCookie(request: Request, name: string): string | undefined {
  return request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
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

  const expected = readCookie(request, STATE_COOKIE);

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
    // With the organisation check off, membership is not asked about at all:
    // the token was not granted read:org, and an invite or an enrolment is the
    // wall instead.
    const orgRequired = orgCheckRequired();
    const [viewer, member] = await Promise.all([
      fetchViewer(token),
      orgRequired ? isActiveOrgMember(token, githubOrg()) : Promise.resolve(false),
    ]);
    access = await resolveAccess(viewer, member, {
      orgRequired,
      inviteToken: readCookie(request, INVITE_COOKIE) ?? null,
    });
  } catch (error) {
    if (error instanceof AuthNotConfigured) return backToSignIn(request, "not_configured");
    if (error instanceof GithubRejected) return backToSignIn(request, "github_refused");
    throw error;
  }

  if (!access.ok) return backToSignIn(request, access.reason);

  const wanted = readCookie(request, NEXT_COOKIE);
  const destination = wanted && wanted.startsWith("/") && !wanted.startsWith("//") ? wanted : "/";

  const response = NextResponse.redirect(publicUrl(destination, request.url));
  response.cookies.set(SESSION_COOKIE, mintSession({ uid: access.userId }, authSecret()), {
    httpOnly: true,
    sameSite: "lax",
    secure: servedOverHttps(request.url),
    path: "/",
    maxAge: SESSION_TTL_S,
  });
  clearRoundTrip(response);
  return response;
}
