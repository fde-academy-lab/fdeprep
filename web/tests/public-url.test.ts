/**
 * Redirects behind a proxy, written before the implementation.
 *
 * Behind Caddy, an ALB or any other proxy, Next.js builds request.url from its
 * own listening address, so every absolute redirect the sign-in flow wrote
 * pointed at https://localhost:3000 and GitHub refused the callback. That was
 * reproduced on a production build of Next.js 16.3.5 on 30 September 2026.
 * APP_URL names the address people actually use, and every absolute URL the
 * sign-in flow writes is built from it.
 *
 * The invite link rides through the same flow, so its cookie is here too.
 */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as start } from "../app/api/auth/start/route.ts";
import { GET as callback } from "../app/api/auth/callback/route.ts";
import { POST as signout } from "../app/api/auth/signout/route.ts";
import { callbackUrl } from "../lib/auth/config.ts";
import { publicOrigin } from "../lib/http/public-url.ts";
import { proxy } from "../proxy.ts";

const TOKEN = "Abc_def-0123456789abcdefghijklmnopqrstuvwxy";

const ENV = {
  APP_URL: "https://prep.example.com",
  GITHUB_CLIENT_ID: "client-for-tests",
  GITHUB_CLIENT_SECRET: "secret-for-tests",
  AUTH_SECRET: "auth-secret-for-tests",
};
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const name of [...Object.keys(ENV), "AUTH_CALLBACK_URL", "GITHUB_ORG_CHECK"]) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
  Object.assign(process.env, ENV);
});

afterEach(() => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

/** What Caddy hands the app: its own address, not the public one. */
const behindProxy = (path: string, init?: RequestInit) =>
  new Request(`http://localhost:3000${path}`, init);

function cookie(response: Response, name: string): string | undefined {
  return response.headers.getSetCookie().find((line) => line.startsWith(`${name}=`));
}

describe("the public address", () => {
  it("comes from APP_URL when it is set, and from the request otherwise", () => {
    expect(publicOrigin("http://localhost:3000/x")).toBe("https://prep.example.com");
    delete process.env.APP_URL;
    expect(publicOrigin("http://localhost:3000/x")).toBe("http://localhost:3000");
  });

  it("names APP_URL when it is not an absolute address", () => {
    process.env.APP_URL = "prep.example.com";
    expect(() => publicOrigin("http://localhost:3000/x")).toThrow(/APP_URL/);
  });

  it("builds the GitHub callback from it, unless AUTH_CALLBACK_URL overrides", () => {
    expect(callbackUrl("http://localhost:3000/api/auth/start"))
      .toBe("https://prep.example.com/api/auth/callback");
    process.env.AUTH_CALLBACK_URL = "https://other.example.com/api/auth/callback";
    expect(callbackUrl("http://localhost:3000/api/auth/start"))
      .toBe("https://other.example.com/api/auth/callback");
  });
});

describe("the sign-in round trip behind a proxy", () => {
  it("sends GitHub the public callback and marks its cookies Secure", async () => {
    const response = await start(behindProxy("/api/auth/start?next=/problems"));
    const location = new URL(response.headers.get("location")!);
    expect(location.host).toBe("github.com");
    expect(location.searchParams.get("redirect_uri"))
      .toBe("https://prep.example.com/api/auth/callback");
    expect(cookie(response, "fdeprep_oauth_state")).toMatch(/Secure/i);
    expect(cookie(response, "fdeprep_oauth_next")).toMatch(/Secure/i);
  });

  it("carries an invite through GitHub in an httpOnly cookie", async () => {
    const response = await start(behindProxy(`/api/auth/start?invite=${TOKEN}`));
    const line = cookie(response, "fdeprep_invite");
    expect(line).toContain(`fdeprep_invite=${TOKEN}`);
    expect(line).toMatch(/HttpOnly/i);
    expect(line).toMatch(/Secure/i);
  });

  it("ignores an invite parameter that is not a token", async () => {
    const response = await start(behindProxy("/api/auth/start?invite=%3Cscript%3E"));
    expect(cookie(response, "fdeprep_invite")).toBeUndefined();
  });

  it("asks GitHub for organisation access only when the organisation is checked", async () => {
    const on = new URL((await start(behindProxy("/api/auth/start"))).headers.get("location")!);
    expect(on.searchParams.get("scope")).toBe("read:user read:org");
    process.env.GITHUB_ORG_CHECK = "off";
    const off = new URL((await start(behindProxy("/api/auth/start"))).headers.get("location")!);
    expect(off.searchParams.get("scope")).toBe("read:user");
  });

  it("sends a refused callback back to the public sign-in page and drops the invite", async () => {
    const response = await callback(behindProxy("/api/auth/callback?code=x&state=y", {
      headers: { cookie: `fdeprep_invite=${TOKEN}` },
    }));
    expect(response.headers.get("location")).toBe("https://prep.example.com/signin?error=bad_state");
    expect(cookie(response, "fdeprep_invite")).toMatch(/fdeprep_invite=;|Max-Age=0|Expires=Thu, 01 Jan 1970/i);
  });

  it("signs out to the public sign-in page", async () => {
    const response = await signout(behindProxy("/api/auth/signout", { method: "POST" }));
    expect(response.headers.get("location")).toBe("https://prep.example.com/signin?error=signed_out");
  });
});

describe("the invite page", () => {
  it("opens without a session, since the person has not signed in yet", async () => {
    const saved = process.env.AUTH_DEV_LEARNER;
    delete process.env.AUTH_DEV_LEARNER;
    try {
      const response = await proxy(new NextRequest(`https://prep.example.com/invite/${TOKEN}`));
      expect(response.headers.get("location")).toBeNull();
      expect(response.status).toBe(200);
    } finally {
      if (saved !== undefined) process.env.AUTH_DEV_LEARNER = saved;
    }
  });
});
