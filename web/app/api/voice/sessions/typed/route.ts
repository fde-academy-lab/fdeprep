/**
 * Save a typed answer and queue it for scoring.
 *
 * The fallback for a learner whose microphone or connection fails. The
 * browser sends the mode, the question slug and the text; the question is
 * resolved on the server and the cap is claimed in the same transaction as
 * the row, so a refusal leaves nothing behind. lib/voice/typed.ts has the
 * rules, including the word limit the question's clock sets.
 *
 * Every reply is JSON, failures included. lib/http/failure.ts says why.
 */
import { NextResponse } from "next/server";
import { jsonBody, signedOut, unexpected } from "@/lib/http/failure";
import { RateLimitError } from "@/lib/policy/caps";
import { QuestionNotFound, resolvePublishedQuestion } from "@/lib/voice/question";
import type { VoiceMode } from "@/lib/voice/start";
import { submitTypedAnswer, TypedAnswerRefused } from "@/lib/voice/typed";
import { learnerOrNull } from "@/lib/session/current";

export const dynamic = "force-dynamic";

const MODES: VoiceMode[] = ["guided", "unguided", "pressure"];

export async function POST(request: Request) {
  try {
    const learner = await learnerOrNull();
    if (!learner) return signedOut();

    const body = await jsonBody<{ mode?: string; question?: string; text?: string }>(request);
    const mode = MODES.find((candidate) => candidate === body?.mode);
    if (!mode || typeof body?.question !== "string" || typeof body.text !== "string") {
      return NextResponse.json(
        { message: "Send the mode, the question and your answer. Nothing was saved." },
        { status: 400 },
      );
    }

    const sessionId = await submitTypedAnswer({
      enrolmentId: learner.enrolmentId,
      cohortId: learner.cohortId,
      voiceQuestionId: await resolvePublishedQuestion(body.question),
      mode,
      text: body.text,
    });
    return NextResponse.json({ sessionId });
  } catch (error) {
    if (error instanceof QuestionNotFound) {
      return NextResponse.json(
        { message: "That question is not published any more. Pick another from the Voice page." },
        { status: error.status },
      );
    }
    if (error instanceof TypedAnswerRefused || error instanceof RateLimitError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    // submitTypedAnswer claims the allowance and writes the row in one
    // transaction, so a failure here has saved nothing and spent nothing.
    return unexpected("saving a typed answer", error,
      "Your answer was not saved because the server hit an error, and nothing was counted. " +
        "It is still in the box: send it again in a minute.");
  }
}
