/**
 * Reading a JSON route's reply in the browser, without trusting it to be JSON.
 *
 * A route that fails in a way it did not plan for answers with Next's own
 * error page, and a proxy or a load balancer in front of it answers with its
 * own HTML. `await response.json()` throws on either, so a screen that called
 * it after `!response.ok` lost the server's status, showed nothing or showed
 * a connection error, and never told the learner what had happened. This
 * reads the body once, keeps the status, and hands back the server's sentence
 * when there is one.
 *
 * Browser-safe: no imports, so a client component can use it.
 */
export type Reply<T> = {
  ok: boolean;
  status: number;
  /** The parsed body, or null when it was empty or not JSON. */
  body: T | null;
  /** The route's own sentence for the learner, when it sent one. */
  message: string | null;
};

export async function readReply<T = Record<string, unknown>>(response: Response): Promise<Reply<T>> {
  let parsed: unknown = null;
  try {
    const text = await response.text();
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  const said = typeof parsed === "object" && parsed !== null
    ? (parsed as { message?: unknown }).message
    : undefined;
  return {
    ok: response.ok,
    status: response.status,
    body: parsed as T | null,
    message: typeof said === "string" ? said : null,
  };
}
