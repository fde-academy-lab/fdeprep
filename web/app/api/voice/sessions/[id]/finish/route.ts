/**
 * Close a voice session and store what the cockpit did.
 *
 * The timeline arrives from the browser because what a cockpit showed is only
 * knowable at the cockpit: docs/07 section 7 makes the live pass explicitly
 * non-authoritative and gives coverage to the judge in the debrief. Nothing
 * stored here reaches a score, the competency heatmap, or the placement
 * export. The session id is checked against the learner's own enrolment, so a
 * browser cannot close somebody else's sitting, and a session that is not the
 * caller's answers as one that does not exist (S15.13).
 *
 * In interview mode (docs/07 section 5a) a main answer that counted leaves
 * the session open, and the reply carries the first follow-up round: who
 * asks, where its audio is, and the token for the reply's own connection.
 * The round is planned and asked here, after the learner has stopped
 * speaking. A retry of a main answer already stored gets the same round back.
 *
 * Every reply is JSON, failures included, because the cockpit decides from
 * the status whether the answer is saved, and tries again on a 500.
 * lib/voice/save.ts reads it; lib/http/failure.ts says why.
 */
import { NextResponse } from "next/server";
import { jsonBody, signedOut, unexpected } from "@/lib/http/failure";
import { finishSession, SessionNotOpen, type TimelineIn } from "@/lib/voice/persist";
import { endInterview, pendingRound } from "@/lib/voice/turns";
import { learnerOrNull } from "@/lib/session/current";
import { ownVoiceSession } from "@/lib/session/records";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const receivedAt = Date.now();
  const { id } = await params;
  try {
    const learner = await learnerOrNull();
    if (!learner) return signedOut();
    if (!(await ownVoiceSession(learner, Number(id)))) {
      return NextResponse.json(
        { message: "That voice session was not found. Open your answers from Past answers." },
        { status: 404 });
    }

    const body = await jsonBody<{
      transcript?: string;
      segments?: { text: string; startMs: number; endMs: number }[];
      timeline?: TimelineIn;
    }>(request);

    if (!body?.timeline || !Array.isArray(body.timeline.beats)) {
      return NextResponse.json({ message: "Needs a timeline." }, { status: 400 });
    }

    const { rounds } = await finishSession({
      sessionId: Number(id),
      enrolmentId: learner.enrolmentId,
      transcript: body.transcript ?? "",
      segments: Array.isArray(body.segments) ? body.segments : [],
      timeline: body.timeline,
    });
    if (!rounds) return NextResponse.json({ finished: Number(id) });
    // The answer is saved before any of this runs, so a round that cannot be
    // asked still leaves a saved answer: the interview closes and is scored,
    // and the cockpit shows the answer as recorded.
    try {
      const turn = await pendingRound(Number(id), { receivedAt });
      return NextResponse.json({ finished: Number(id), turn });
    } catch (error) {
      console.error(`opening the first round of voice session ${id} failed:`, error);
      await endInterview(Number(id));
      return NextResponse.json({ finished: Number(id), turn: null });
    }
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
