/**
 * Open a voice session in one of the three modes, on the question named.
 *
 * The browser sends a mode, a question slug and, optionally, an interviewer
 * slug, and nothing else. The enrolment comes from the signed-in learner, the
 * question is resolved on the server to a published one, the interviewer to a
 * published one or the question's first, the socket address comes from
 * configuration, and the consent gate and the cap refuse before any row is
 * written. A slug that names nothing is refused rather than swapped for
 * another, which is how every answer used to be filed under the docs/07
 * fixture.
 *
 * Every reply is JSON, failures included, because the cockpit reads it with
 * fetch. lib/http/failure.ts says why.
 */
import { NextResponse } from "next/server";
import { jsonBody, signedOut, unexpected } from "@/lib/http/failure";
import { RateLimitError } from "@/lib/policy/caps";
import { ConsentRequired } from "@/lib/voice/consent";
import { InterviewerNotFound } from "@/lib/voice/interviewers";
import { QuestionNotFound, resolvePublishedQuestion } from "@/lib/voice/question";
import { ResumeRefused } from "@/lib/voice/resume";
import { startVoiceSession, VoiceNotConfigured, type VoiceMode } from "@/lib/voice/start";
import { learnerOrNull } from "@/lib/session/current";

export const dynamic = "force-dynamic";

const MODES: VoiceMode[] = ["guided", "unguided", "pressure", "interview"];

/**
 * Interview mode may carry a pasted resume (docs/07 section 9, as amended
 * for S14.2). It is read here only in that mode, passed on once, and never
 * written: no failure below names the body, and the one that can follow it,
 * the claims step, logs a fixed sentence of its own.
 */
export async function POST(request: Request) {
  try {
    const learner = await learnerOrNull();
    if (!learner) return signedOut();

    const body = await jsonBody<{
      mode?: string; question?: string; interviewer?: unknown; resume?: unknown;
    }>(request);
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
      // A slug and nothing more. Anything else in the field is ignored, and
      // the question's first interviewer asks instead.
      interviewerSlug: typeof body.interviewer === "string" && body.interviewer ? body.interviewer : null,
      resume: mode === "interview" && typeof body.resume === "string" ? body.resume : null,
    });
    return NextResponse.json(started);
  } catch (error) {
    if (error instanceof ResumeRefused) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    if (error instanceof QuestionNotFound) {
      return NextResponse.json(
        { message: "That question is not published any more. Pick another from the Voice page." },
        { status: error.status },
      );
    }
    if (error instanceof InterviewerNotFound) {
      return NextResponse.json(
        { message: "That interviewer is not available any more, so nothing started and nothing " +
                   "was counted. Pick another interviewer above the question." },
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
