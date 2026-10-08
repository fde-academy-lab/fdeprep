/**
 * What sign-in needs from the environment, and what it refuses to run without.
 *
 * Every value is read through a function rather than captured at module load,
 * because a module read at import time in a test or a build picks up whatever
 * was set then and nothing can change it afterwards.
 */
import { publicUrl } from "../http/public-url.ts";
import { logOnce } from "../log-once.ts";

export class AuthNotConfigured extends Error {}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new AuthNotConfigured(
      `${name} is not set, so nobody can sign in. See the sign-in section of SETUP.md.`);
  }
  return value;
}

export function authSecret(): string {
  return required("AUTH_SECRET");
}

export function githubClientId(): string {
  return required("GITHUB_CLIENT_ID");
}

export function githubClientSecret(): string {
  return required("GITHUB_CLIENT_SECRET");
}

/** The organisation whose members may sign in. docs/00 section 2. */
export function githubOrg(): string {
  return process.env.GITHUB_ORG ?? "FDE-Academy-Hub";
}

type OrgEnv = Readonly<Record<string, string | undefined>>;

/**
 * Whether sign-in requires organisation membership. docs/00 section 2,
 * amended 30 September 2026.
 *
 * On unless GITHUB_ORG_CHECK=off. The beta turns it off, because its testers
 * hold GitHub accounts outside the organisation, and an invite replaces it as
 * the wall. Anything other than on or off is refused rather than read as one
 * of them, so a typo cannot open the door.
 */
export function orgCheckRequired(env: OrgEnv = process.env): boolean {
  const value = env.GITHUB_ORG_CHECK?.trim();
  if (value === undefined || value === "" || value === "on") return true;
  if (value === "off") return false;
  throw new Error(`GITHUB_ORG_CHECK must be "on" or "off", got "${value}".`);
}

/** What sign-in asks GitHub for. read:org only when membership is checked. */
export function oauthScope(env: OrgEnv = process.env): string {
  return orgCheckRequired(env) ? "read:user read:org" : "read:user";
}

/** Where GitHub sends the browser back. Must match the OAuth application's
 *  callback URL exactly, including scheme and port. Built from APP_URL when
 *  the app sits behind a proxy; AUTH_CALLBACK_URL overrides both. */
export function callbackUrl(requestUrl: string): string {
  const configured = process.env.AUTH_CALLBACK_URL;
  if (configured) return configured;
  return publicUrl("/api/auth/callback", requestUrl).toString();
}

/** Just the three names these two read. NodeJS.ProcessEnv insists on a literal
 *  NODE_ENV, which makes a test env object impossible to write honestly. */
export type AuthEnv = Partial<Record<"AUTH_DEV_LEARNER" | "GITHUB_CLIENT_ID" | "NODE_ENV", string>>;

export function githubConfigured(env: AuthEnv = process.env): boolean {
  return Boolean(env.GITHUB_CLIENT_ID);
}

/**
 * Called by a page that has nothing to sign in with. The page says sign-in
 * is not set up and names nothing; this line tells whoever runs the
 * deployment what is missing, once per process.
 */
export function logSignInNotSetUp(): void {
  logOnce("Sign-in is not set up: set GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET and AUTH_SECRET " +
          "(SETUP.md, the sign-in section), or AUTH_DEV_LEARNER=1 to run without sign-in on a laptop.");
}

/**
 * The development learner, off unless asked for.
 *
 * Three conditions, all of them. It has to be switched on explicitly, there
 * must be no GitHub application configured, and NODE_ENV must not be
 * production. The last one is the one that matters: a deploy that sets this by
 * accident signs every visitor in as the same administrator, which is exactly
 * the hole this whole change exists to close.
 */
export function devLearnerEnabled(env: AuthEnv = process.env): boolean {
  if (env.AUTH_DEV_LEARNER !== "1") return false;
  if (githubConfigured(env)) return false;
  return env.NODE_ENV !== "production";
}
