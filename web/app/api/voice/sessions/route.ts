/**
 * Open a voice session in one of the three modes, on the question named.
 *
 * The browser sends a mode and a question slug and nothing else. The
 * enrolment comes from the signed-in learner, the question is resolved on the
 * server to a published one, the socket address comes from configuration,
 * and the consent gate and the cap refuse before any row is written. A slug
 * that names nothing is refused rather than swapped for another question,
 * which is how every answer used to be filed under the docs/07 fixture.
 *
 * Every reply is JSON, failures included, because the cockpit reads it with
 * fetch. lib/http/failure.ts says why.
 */
import { NextResponse } from "next/server";
import { jsonBody, signedOut, unexpected } from "@/lib/http/failure";
import { RateLimitError } from "@/lib/policy/caps";
import { ConsentRequired } from "@/lib/voice/consent";
import { QuestionNotFound, resolvePublishedQuestion } from "@/lib/voice/question";
import { startVoiceSession, VoiceNotConfigured, type VoiceMode } from "@/lib/voice/start";
import { learnerOrNull } from "@/lib/session/current";

export const dynamic = "force-dynamic";

const MODES: VoiceMode[] = ["guided", "unguided", "pressure"];

export async function POST(request: Request) {
  try {
    const learner = await learnerOrNull();
    if (!learner) return signedOut();

    const body = await jsonBody<{ mode?: string; question?: string }>(request);
    const mode = MODES.find((candidate) => candidate === body?.mode);
    if (!mode) {
      return NextResponse.json(
        { message: `Pick one of ${MODES.join(", ")}.` },
        { status: 400 },
      );
    }
    if (typeof body?.question !== "string" || body.question.length === 0) {
      return NextResponse.json(
        { message: "Pick a question first. The list is on the Voice page." },
        { status: 400 },
      );
    }

    const started = await startVoiceSession({
      enrolmentId: learner.enrolmentId,
      cohortId: learner.cohortId,
      voiceQuestionId: await resolvePublishedQuestion(body.question),
      mode,
    });
    return NextResponse.json(started);
  } catch (error) {
    if (error instanceof QuestionNotFound) {
      return NextResponse.json(
        { message: "That question is not published any more. Pick another from the Voice page." },
        { status: error.status },
      );
    }
    if (error instanceof ConsentRequired || error instanceof VoiceNotConfigured ||
        error instanceof RateLimitError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return unexpected("opening a voice session", error,
      "The answer did not start because the server hit an error. Try again in a minute, or " +
        "type the answer instead.");
  }
}
