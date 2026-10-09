import { NextResponse } from "next/server";
import { signedOut } from "@/lib/http/failure";
import { learnerOrNull } from "@/lib/session/current";
import { readableSubmission } from "@/lib/session/records";
import { publicView } from "@/lib/submissions/view";

export const dynamic = "force-dynamic";

/**
 * Result delivery over server-sent events.
 *
 * The client falls back to polling the sibling route when the stream cannot be
 * held open. Both read the same trimmed view, so a hidden case name cannot
 * reach the browser through either path, and both decide who may read it the
 * same way, once, before anything is sent: the owner, faculty of the owner's
 * cohort and admins (lib/session/records.ts). Anyone else gets the answer a
 * number nobody holds gets (S15.13).
 */
export async function GET(
  _request: Request, { params }: { params: Promise<{ id: string }> },
) {
  const viewer = await learnerOrNull();
  if (!viewer) return signedOut();
  const submissionId = Number((await params).id);
  if (!(await readableSubmission(viewer, submissionId))) {
    return NextResponse.json(
      { message: "That submission was not found. Open it again from the problem page." },
      { status: 404 });
  }
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
        clearTimeout(giveUp);
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
      const giveUp = setTimeout(finish, 120_000);
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
