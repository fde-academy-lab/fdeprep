/**
 * The address people actually use, for every absolute URL the app writes.
 *
 * Behind Caddy, an ALB or any other proxy, Next.js builds request.url from its
 * own listening address, so a redirect built from it points at
 * https://localhost:3000. Next's only switch for trusting the Host header is
 * internal: it turns on by itself on Vercel, and next.config.ts rejects it as
 * an unrecognised key. Both were checked against Next.js 16.3.5 on
 * 30 September 2026. APP_URL names the public address instead; where it is
 * unset, as on a laptop or on Vercel, the request's own origin is right.
 */
type Env = Readonly<Record<string, string | undefined>>;

export function publicOrigin(requestUrl: string, env: Env = process.env): string {
  const configured = env.APP_URL?.trim();
  if (!configured) return new URL(requestUrl).origin;

  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error(
      `APP_URL must be an absolute address such as https://prep.example.com, got "${configured}".`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`APP_URL must start with https:// or http://, got "${configured}".`);
  }
  return parsed.origin;
}

/** A path on the public address. The path comes from our own code, never a request. */
export function publicUrl(path: string, requestUrl: string): URL {
  return new URL(path, publicOrigin(requestUrl));
}

/** Whether a cookie should carry Secure: true whenever people reach us over HTTPS. */
export function servedOverHttps(requestUrl: string): boolean {
  return publicOrigin(requestUrl).startsWith("https:");
}
