/**
 * Sign-in, written before the implementation.
 *
 * Two PRD acceptance items live here. Item 1: a learner in the GitHub
 * organisation can sign in and see a roadmap matching their persona. Item 8: a
 * learner removed from the organisation cannot sign in on their next session.
 * Neither was implemented, and until now every visitor resolved to the first
 * enrolment row in the table.
 *
 * The three refusals come from docs/01 section S1 and their wording is part of
 * the contract, so they are asserted literally rather than by shape. A learner
 * who cannot get in needs to know which of the three walls they hit, because
 * the fix is different each time and only one of them is theirs.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../lib/db/pool.ts";
import {
  authorizeUrl, exchangeCode, fetchViewer, isActiveOrgMember, GithubRejected,
} from "../lib/auth/github.ts";
import { SESSION_COOKIE, SESSION_TTL_S, SessionRejected, mintSession, readSession } from "../lib/auth/session.ts";
import { resolveAccess } from "../lib/auth/access.ts";
import { devLearnerEnabled, githubConfigured } from "../lib/auth/config.ts";
import { proxy } from "../proxy.ts";
import { resetDatabase, seedLearner } from "./helpers.ts";

const SECRET = "a-test-signing-secret";

const VIEWER = {
  id: 4242,
  login: "asha",
  name: "Asha R",
  avatarUrl: "https://avatars.githubusercontent.com/u/4242",
  email: "asha@example.com",
};

/** A fetch that answers a fixed map of URLs and records what it was asked. */
function fakeFetch(routes: Record<string, { status: number; body?: unknown }>) {
  const seen: Array<{ url: string; init?: RequestInit }> = [];
  const impl = async (url: string | URL, init?: RequestInit): Promise<Response> => {
    const key = String(url);
    seen.push({ url: key, init });
    const hit = routes[key];
    if (!hit) return new Response("no route", { status: 599 });
    return new Response(hit.body === undefined ? "" : JSON.stringify(hit.body), {
      status: hit.status,
      headers: { "content-type": "application/json" },
    });
  };
  return Object.assign(impl, { seen });
}

afterAll(async () => {
  await closeDb();
});

describe("the session cookie", () => {
  it("round-trips the user it was minted for", () => {
    const cookie = mintSession({ uid: 17 }, SECRET);
    expect(readSession(cookie, SECRET).uid).toBe(17);
  });

  it("refuses a payload someone edited", () => {
    const cookie = mintSession({ uid: 17 }, SECRET);
    const [payload, signature] = cookie.split(".");
    const forged = Buffer.from(JSON.stringify({ uid: 1, exp: 9_999_999_999 }))
      .toString("base64url");
    expect(() => readSession(`${forged}.${signature}`, SECRET)).toThrow(SessionRejected);
    expect(payload).not.toBe(forged);
  });

  it("refuses a cookie signed with another secret", () => {
    const cookie = mintSession({ uid: 17 }, "someone-elses-secret");
    expect(() => readSession(cookie, SECRET)).toThrow(SessionRejected);
  });

  it("refuses a cookie past its expiry", () => {
    const nowS = 1_000_000;
    const cookie = mintSession({ uid: 17 }, SECRET, nowS);
    expect(readSession(cookie, SECRET, nowS + SESSION_TTL_S - 1).uid).toBe(17);
    expect(() => readSession(cookie, SECRET, nowS + SESSION_TTL_S + 1)).toThrow(SessionRejected);
  });

  it("refuses a malformed cookie without throwing something unhelpful", () => {
    for (const bad of ["", "nodot", "a.b.c", "!!!.???"]) {
      expect(() => readSession(bad, SECRET), bad).toThrow(SessionRejected);
    }
  });

  it("names the cookie so it cannot be read from JavaScript by accident", () => {
    // The name is asserted because the route sets it by this constant and the
    // reader looks it up by the same one. A rename in one place only is the
    // failure this catches.
    expect(SESSION_COOKIE).toBe("fdeprep_session");
  });
});

describe("the GitHub OAuth surface", () => {
  it("builds an authorize URL carrying the state it was given", () => {
    const url = new URL(authorizeUrl({
      clientId: "cid", redirectUri: "https://app.example/api/auth/callback", state: "st4te",
    }));
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.example/api/auth/callback");
    expect(url.searchParams.get("state")).toBe("st4te");
    // read:org is what GET /user/memberships/orgs/{org} needs to see a
    // membership the user has not made public.
    expect(url.searchParams.get("scope")).toContain("read:org");
  });

  it("exchanges a code for a token and asks for JSON", async () => {
    const fetchImpl = fakeFetch({
      "https://github.com/login/oauth/access_token": {
        status: 200, body: { access_token: "gho_test", token_type: "bearer" },
      },
    });
    const token = await exchangeCode({
      code: "c0de", clientId: "cid", clientSecret: "shh",
      redirectUri: "https://app.example/api/auth/callback",
    }, fetchImpl);
    expect(token).toBe("gho_test");

    const call = fetchImpl.seen[0]!;
    expect(call.init?.method).toBe("POST");
    expect(new Headers(call.init?.headers).get("accept")).toBe("application/json");
    expect(String(call.init?.body)).toContain("c0de");
  });

  it("treats an error body from the token exchange as a refusal", async () => {
    const fetchImpl = fakeFetch({
      "https://github.com/login/oauth/access_token": {
        status: 200, body: { error: "bad_verification_code" },
      },
    });
    await expect(exchangeCode({
      code: "stale", clientId: "cid", clientSecret: "shh",
      redirectUri: "https://app.example/api/auth/callback",
    }, fetchImpl)).rejects.toThrow(GithubRejected);
  });

  it("reads the viewer", async () => {
    const fetchImpl = fakeFetch({
      "https://api.github.com/user": {
        status: 200,
        body: {
          id: 4242, login: "asha", name: "Asha R", email: "asha@example.com",
          avatar_url: "https://avatars.githubusercontent.com/u/4242",
        },
      },
    });
    await expect(fetchViewer("gho_test", fetchImpl)).resolves.toEqual(VIEWER);
  });

  describe("organisation membership", () => {
    const url = "https://api.github.com/user/memberships/orgs/FDE-Academy-Hub";

    it("is true for an active member", async () => {
      const fetchImpl = fakeFetch({ [url]: { status: 200, body: { state: "active" } } });
      await expect(isActiveOrgMember("gho", "FDE-Academy-Hub", fetchImpl)).resolves.toBe(true);
    });

    it("is false for someone who never joined", async () => {
      const fetchImpl = fakeFetch({ [url]: { status: 404, body: { message: "Not Found" } } });
      await expect(isActiveOrgMember("gho", "FDE-Academy-Hub", fetchImpl)).resolves.toBe(false);
    });

    it("is false for a pending invitation, which is not membership yet", async () => {
      const fetchImpl = fakeFetch({ [url]: { status: 200, body: { state: "pending" } } });
      await expect(isActiveOrgMember("gho", "FDE-Academy-Hub", fetchImpl)).resolves.toBe(false);
    });

    it("throws rather than guessing when GitHub refuses the question", async () => {
      // 403 is an organisation policy blocking the call, not an answer. Reading
      // it as "not a member" would lock out a whole cohort on a policy change.
      const fetchImpl = fakeFetch({ [url]: { status: 403, body: { message: "Forbidden" } } });
      await expect(isActiveOrgMember("gho", "FDE-Academy-Hub", fetchImpl))
        .rejects.toThrow(GithubRejected);
    });
  });
});

describe("resolving who is allowed in", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("lets an organisation member on an active roster in", async () => {
    const seeded = await seedLearner({ githubId: VIEWER.id, login: VIEWER.login });
    const access = await resolveAccess(VIEWER, true);

    expect(access.ok).toBe(true);
    if (!access.ok) return;
    expect(access.enrolmentId).toBe(seeded.enrolmentId);
    expect(access.cohortId).toBe(seeded.cohortId);
    expect(access.role).toBe("learner");
    expect(access.persona).toBe("navigator");
  });

  // docs/01 S1: three failures, three messages, each naming what to do next.
  it("refuses someone outside the organisation, and says which wall it is", async () => {
    const access = await resolveAccess(VIEWER, false);
    expect(access).toEqual({
      ok: false,
      reason: "not_a_member",
      message: "Your GitHub account is not in the FDE Academy organisation yet.",
    });
  });

  it("refuses a member who is on no roster", async () => {
    const access = await resolveAccess(VIEWER, true);
    expect(access).toEqual({
      ok: false,
      reason: "not_enrolled",
      message: "Your account is not enrolled in an active cohort.",
    });
  });

  it("refuses a member whose enrolment has ended", async () => {
    await seedLearner({ githubId: VIEWER.id, login: VIEWER.login });
    await db().query("update enrolment set state = 'ended'");
    const access = await resolveAccess(VIEWER, true);
    expect(access).toEqual({
      ok: false,
      reason: "enrolment_ended",
      message: "Your enrolment has ended. Past submissions stay readable for thirty days.",
    });
  });

  it("does not create an account for someone outside the organisation", async () => {
    await resolveAccess(VIEWER, false);
    const { rows } = await db().query("select 1 from app_user where github_id = $1", [VIEWER.id]);
    expect(rows).toHaveLength(0);
  });

  it("keeps the GitHub profile current on every sign-in", async () => {
    await seedLearner({ githubId: VIEWER.id, login: "old-login" });
    await resolveAccess({ ...VIEWER, login: "asha-renamed", name: "Asha Renamed" }, true);

    const { rows } = await db().query<{ github_login: string; display_name: string; last_seen_at: Date | null }>(
      "select github_login, display_name, last_seen_at from app_user where github_id = $1",
      [VIEWER.id]);
    expect(rows[0]!.github_login).toBe("asha-renamed");
    expect(rows[0]!.display_name).toBe("Asha Renamed");
    expect(rows[0]!.last_seen_at).not.toBeNull();
  });

  /** PRD acceptance 8, stated as the thing an operator actually does. */
  it("stops admitting someone the moment they leave the organisation", async () => {
    await seedLearner({ githubId: VIEWER.id, login: VIEWER.login });
    expect((await resolveAccess(VIEWER, true)).ok).toBe(true);

    // Offboarding is removing them from the GitHub organisation and nothing
    // else. The enrolment row is untouched, exactly as it would be in life.
    const after = await resolveAccess(VIEWER, false);
    expect(after.ok).toBe(false);
    if (after.ok) return;
    expect(after.reason).toBe("not_a_member");
  });

  it("resolves the enrolment from the database rather than from anything a browser sent", async () => {
    // The signed cookie carries a user id and nothing else. Role, persona,
    // cohort and enrolment are read here, so a forged claim has nothing to
    // forge: .claude/rules/01, client input is never authoritative.
    const seeded = await seedLearner({ githubId: VIEWER.id, login: VIEWER.login });
    await db().query("update enrolment set role = 'faculty', persona = 'accelerator'");
    const access = await resolveAccess(VIEWER, true);

    expect(access.ok).toBe(true);
    if (!access.ok) return;
    expect(access.role).toBe("faculty");
    expect(access.persona).toBe("accelerator");
    expect(access.enrolmentId).toBe(seeded.enrolmentId);
  });
});

describe("the development learner", () => {
  it("is off unless it is asked for", () => {
    expect(devLearnerEnabled({})).toBe(false);
  });

  it("is on when asked for on a machine with no GitHub application", () => {
    expect(devLearnerEnabled({ AUTH_DEV_LEARNER: "1", NODE_ENV: "development" })).toBe(true);
  });

  // The hole this whole change exists to close. A deployment that sets the
  // switch by accident must not sign every visitor in as the same admin.
  it("refuses in production however loudly it is asked for", () => {
    expect(devLearnerEnabled({ AUTH_DEV_LEARNER: "1", NODE_ENV: "production" })).toBe(false);
  });

  it("refuses whenever a GitHub application is configured", () => {
    const env = { AUTH_DEV_LEARNER: "1", NODE_ENV: "development", GITHUB_CLIENT_ID: "cid" };
    expect(devLearnerEnabled(env)).toBe(false);
    expect(githubConfigured(env)).toBe(true);
  });
});

describe("the proxy", () => {
  const ask = (path: string, cookie?: string) => {
    const request = new Request(`https://app.example${path}`, {
      headers: cookie ? { cookie } : undefined,
    });
    // NextRequest's shape, as much of it as the proxy touches.
    return proxy(Object.assign(request, {
      nextUrl: new URL(`https://app.example${path}`),
      cookies: { has: (name: string) => Boolean(cookie?.includes(`${name}=`)) },
    }) as never);
  };

  it("sends a signed-out visitor to the sign-in screen", () => {
    const response = ask("/problems");
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/signin");
    expect(location.searchParams.get("next")).toBe("/problems");
  });

  it("answers a signed-out API call with 401 rather than a redirect", () => {
    // A fetch cannot parse an HTML sign-in page, so the submit button would
    // fail with something meaningless instead of saying the session ended.
    const response = ask("/api/submissions");
    expect(response.status).toBe(401);
  });

  it("lets the sign-in screen and the OAuth round trip through", () => {
    for (const path of ["/signin", "/api/auth/start", "/api/auth/callback"]) {
      expect(ask(path).status, path).toBe(200);
    }
  });

  it("lets a request carrying a session cookie through", () => {
    expect(ask("/problems", `${SESSION_COOKIE}=anything`).status).toBe(200);
  });

  it("does not put a full URL in the next parameter", () => {
    // An absolute value here is an open redirect: sign in, get bounced to
    // somebody else's site carrying whatever the page leaks.
    const location = new URL(ask("/progress").headers.get("location")!);
    expect(location.searchParams.get("next")).toBe("/progress");
    expect(location.searchParams.get("next")).not.toContain("://");
  });
});
