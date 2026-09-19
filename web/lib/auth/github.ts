/**
 * The four GitHub calls sign-in makes, and nothing else.
 *
 * Endpoints and parameter names verified against GitHub's own documentation on
 * 19 September 2026:
 *   https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps
 *   https://docs.github.com/en/rest/orgs/members
 *
 * `fetch` is a parameter rather than a global so the whole surface is testable
 * without a network, which is the only way the refusal paths get exercised at
 * all. Nobody is going to arrange a 403 from a real organisation to check we
 * handle it.
 *
 * The access token is used here and never stored. It buys two reads, the
 * viewer and the organisation membership, and is then dropped. A stored GitHub
 * token would be a credential this application has no reason to hold and every
 * reason not to.
 */
export const AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
export const TOKEN_URL = "https://github.com/login/oauth/access_token";
export const API = "https://api.github.com";

/** read:org sees a membership the user has not made public, which most are.
 *  Without it a private member reads as no member and the cohort cannot sign
 *  in. read:user carries the display name and avatar. */
export const SCOPE = "read:user read:org";

export type FetchLike = (url: string | URL, init?: RequestInit) => Promise<Response>;

export interface GithubViewer {
  id: number;
  login: string;
  name: string | null;
  avatarUrl: string | null;
  email: string | null;
}

export class GithubRejected extends Error {}

export function authorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  url.searchParams.set("scope", SCOPE);
  // No public sign-up: docs/00 section 2. Offering one on the GitHub screen
  // sends somebody off to make an account that still will not get them in.
  url.searchParams.set("allow_signup", "false");
  return url.toString();
}

export async function exchangeCode(
  input: { code: string; clientId: string; clientSecret: string; redirectUri: string },
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const response = await fetchImpl(TOKEN_URL, {
    method: "POST",
    // Without this header GitHub answers in form encoding, which is a silent
    // parse failure rather than a loud one.
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      redirect_uri: input.redirectUri,
    }).toString(),
  });

  if (!response.ok) {
    throw new GithubRejected(`GitHub refused the sign-in exchange with ${response.status}.`);
  }
  const body = (await response.json()) as { access_token?: string; error?: string };
  // A stale or reused code comes back 200 with an error field, so the status
  // alone proves nothing.
  if (body.error || !body.access_token) {
    throw new GithubRejected(
      `GitHub refused the sign-in exchange: ${body.error ?? "no access token returned"}.`);
  }
  return body.access_token;
}

export async function fetchViewer(
  token: string,
  fetchImpl: FetchLike = fetch,
): Promise<GithubViewer> {
  const response = await fetchImpl(`${API}/user`, { headers: headers(token) });
  if (!response.ok) {
    throw new GithubRejected(`GitHub would not say who signed in (${response.status}).`);
  }
  const body = (await response.json()) as {
    id: number; login: string; name: string | null;
    avatar_url: string | null; email: string | null;
  };
  return {
    id: body.id,
    login: body.login,
    name: body.name ?? null,
    avatarUrl: body.avatar_url ?? null,
    email: body.email ?? null,
  };
}

/**
 * Is this person actually in the organisation right now.
 *
 * 200 with state "active" is the only yes. A pending invitation is state
 * "pending" and is not membership: somebody invited but not joined has not
 * accepted anything, and letting them in early makes the invitation the
 * control rather than the joining.
 *
 * 404 is a real no, and every other status throws. A 403 is an organisation
 * policy refusing the question, and reading that as "not a member" would sign
 * out an entire cohort the day somebody changes a setting.
 */
export async function isActiveOrgMember(
  token: string,
  org: string,
  fetchImpl: FetchLike = fetch,
): Promise<boolean> {
  const response = await fetchImpl(
    `${API}/user/memberships/orgs/${encodeURIComponent(org)}`, { headers: headers(token) });

  if (response.status === 404) return false;
  if (!response.ok) {
    throw new GithubRejected(
      `GitHub would not answer whether you are in ${org} (${response.status}). ` +
      "This is an organisation setting rather than your account. Contact your programme manager.");
  }
  const body = (await response.json()) as { state?: string };
  return body.state === "active";
}

function headers(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
  };
}
