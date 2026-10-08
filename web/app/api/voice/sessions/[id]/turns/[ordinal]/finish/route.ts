/**
 * Store one reply to a follow-up round, and hand back the next round or the
 * close. docs/07 section 5a.
 *
 * The browser sends what the transcriber heard during the reply, how long
 * the reply ran, and whether the learner pressed Stop or Next question, which
 * ends the interview here. Everything else, the next round's interviewer, its
 * kind, its words, its voice and its token, is decided on the server, after
 * the learner has stopped speaking. The session is checked against the
 * learner's own enrolment, so a browser cannot answer somebody else's round.
 *
 * Every reply is JSON, failures included: lib/voice/save.ts tries again on a
 * 500 and treats a refusal as final.
 */
import { NextResponse } from "next/server";
import { jsonBody, signedOut, unexpected } from "@/lib/http/failure";
import { finishTurn, TurnNotOpen } from "@/lib/voice/turns";
import { learnerOrNull } from "@/lib/session/current";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request, { params }: { params: Promise<{ id: string; ordinal: string }> },
) {
  const receivedAt = Date.now();
  const { id, ordinal } = await params;
  const sessionId = Number(id);
  const turn = Number(ordinal);
  try {
    const learner = await learnerOrNull();
    if (!learner) return signedOut();
    if (!Number.isSafeInteger(sessionId) || !Number.isSafeInteger(turn) || turn < 1) {
      return NextResponse.json({ message: "There is no such round. Open the debrief from Past answers." },
                               { status: 404 });
    }

    const body = await jsonBody<{
      transcript?: unknown;
      segments?: unknown;
      replyMs?: unknown;
      close?: unknown;
    }>(request);
    const segments = Array.isArray(body?.segments)
      ? (body.segments as Array<{ text?: unknown; startMs?: unknown; endMs?: unknown }>)
          .filter((segment) => typeof segment?.text === "string")
          .map((segment) => ({
            text: String(segment.text),
            startMs: Number(segment.startMs) || 0,
            endMs: Number(segment.endMs) || 0,
          }))
      : [];

    const outcome = await finishTurn({
      sessionId,
      enrolmentId: learner.enrolmentId,
      ordinal: turn,
      transcript: typeof body?.transcript === "string" ? body.transcript : "",
      segments,
      replyMs: typeof body?.replyMs === "number" ? body.replyMs : undefined,
      close: body?.close === true,
    }, { receivedAt });
    return NextResponse.json(outcome.closed ? { closed: true } : { closed: false, turn: outcome.turn });
  } catch (error) {
    if (error instanceof TurnNotOpen) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return unexpected(`saving round ${ordinal} of voice session ${id}`, error,
      "Your reply was not saved because the server hit an error. Nothing was changed, so send " +
        "it again.");
  }
}
