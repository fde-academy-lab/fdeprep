/**
 * What sign-in needs from the environment, and what it refuses to run without.
 *
 * Every value is read through a function rather than captured at module load,
 * because a module read at import time in a test or a build picks up whatever
 * was set then and nothing can change it afterwards.
 */
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

/** Where GitHub sends the browser back. Must match the OAuth application's
 *  callback URL exactly, including scheme and port. */
export function callbackUrl(requestUrl: string): string {
  const configured = process.env.AUTH_CALLBACK_URL;
  if (configured) return configured;
  return new URL("/api/auth/callback", requestUrl).toString();
}

/** Just the three names these two read. NodeJS.ProcessEnv insists on a literal
 *  NODE_ENV, which makes a test env object impossible to write honestly. */
export type AuthEnv = Partial<Record<"AUTH_DEV_LEARNER" | "GITHUB_CLIENT_ID" | "NODE_ENV", string>>;

export function githubConfigured(env: AuthEnv = process.env): boolean {
  return Boolean(env.GITHUB_CLIENT_ID);
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
