/**
 * Close a voice session and store what the cockpit did.
 *
 * The timeline arrives from the browser because what a cockpit showed is only
 * knowable at the cockpit: docs/07 section 7 makes the live pass explicitly
 * non-authoritative and gives coverage to the judge in the debrief. Nothing
 * stored here reaches a score, the competency heatmap, or the placement
 * export. The session id is checked against the learner's own enrolment, so a
 * browser cannot close somebody else's sitting.
 */
import { NextResponse } from "next/server";
import { finishSession, SessionNotOpen, type TimelineIn } from "@/lib/voice/persist";
import { currentLearner } from "@/lib/session/current";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const learner = await currentLearner();
    const { id } = await params;
    const body = (await request.json()) as { transcript?: string; timeline?: TimelineIn };

    if (!body.timeline || !Array.isArray(body.timeline.beats)) {
      return NextResponse.json({ message: "Needs a timeline." }, { status: 400 });
    }

    await finishSession({
      sessionId: Number(id),
      enrolmentId: learner.enrolmentId,
      transcript: body.transcript ?? "",
      timeline: body.timeline,
    });
    return NextResponse.json({ finished: Number(id) });
  } catch (error) {
    if (error instanceof SessionNotOpen) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    throw error;
  }
}
