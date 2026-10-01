/**
 * Close a voice session and store what the cockpit did.
 *
 * The timeline arrives from the browser because what a cockpit showed is only
 * knowable at the cockpit: docs/07 section 7 makes the live pass explicitly
 * non-authoritative and gives coverage to the judge in the debrief. Nothing
 * stored here reaches a score, the competency heatmap, or the placement
 * export. The session id is checked against the learner's own enrolment, so a
 * browser cannot close somebody else's sitting.
 *
 * Every reply is JSON, failures included, because the cockpit decides from
 * the status whether the answer is saved, and tries again on a 500.
 * lib/voice/save.ts reads it; lib/http/failure.ts says why.
 */
import { NextResponse } from "next/server";
import { jsonBody, signedOut, unexpected } from "@/lib/http/failure";
import { finishSession, SessionNotOpen, type TimelineIn } from "@/lib/voice/persist";
import { learnerOrNull } from "@/lib/session/current";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const learner = await learnerOrNull();
    if (!learner) return signedOut();

    const body = await jsonBody<{
      transcript?: string;
      segments?: { text: string; startMs: number; endMs: number }[];
      timeline?: TimelineIn;
    }>(request);

    if (!body?.timeline || !Array.isArray(body.timeline.beats)) {
      return NextResponse.json({ message: "Needs a timeline." }, { status: 400 });
    }

    await finishSession({
      sessionId: Number(id),
      enrolmentId: learner.enrolmentId,
      transcript: body.transcript ?? "",
      segments: Array.isArray(body.segments) ? body.segments : [],
      timeline: body.timeline,
    });
    return NextResponse.json({ finished: Number(id) });
  } catch (error) {
    if (error instanceof SessionNotOpen) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    // finishSession writes in one transaction, so a failure has changed
    // nothing and the same request can be sent again.
    return unexpected(`saving voice session ${id}`, error,
      "The answer was not saved because the server hit an error. Nothing was changed, so " +
        "send it again.");
  }
}
