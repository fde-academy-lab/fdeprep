import { publicView } from "@/lib/submissions/view";

export const dynamic = "force-dynamic";

/**
 * Result delivery over server-sent events.
 *
 * The client falls back to polling the sibling route when the stream cannot be
 * held open. Both read the same trimmed view, so a hidden case name cannot
 * reach the browser through either path.
 */
export async function GET(
  _request: Request, { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const submissionId = Number(id);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const push = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      const finish = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        controller.close();
      };

      const tick = async () => {
        try {
          const view = await publicView(submissionId);
          push("state", view);
          if (view.status === "terminal") {
            push("done", { id: view.id, verdict: view.verdict });
            finish();
          }
        } catch {
          push("error", { message: "That submission could not be read." });
          finish();
        }
      };

      const timer = setInterval(() => { void tick(); }, 500);
      // Give up after two minutes; the client reconnects or falls back to
      // polling, and the result is durable either way.
      setTimeout(finish, 120_000);
      await tick();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
