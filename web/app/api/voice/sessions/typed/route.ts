/**
 * Save a typed answer and queue it for scoring.
 *
 * The fallback for a learner whose microphone or connection fails. The
 * browser sends the mode, the question slug and the text; the question is
 * resolved on the server and the cap is claimed in the same transaction as
 * the row, so a refusal leaves nothing behind. lib/voice/typed.ts has the
 * rules, including the word limit the question's clock sets.
 */
import { NextResponse } from "next/server";
import { RateLimitError } from "@/lib/policy/caps";
import { QuestionNotFound, resolvePublishedQuestion } from "@/lib/voice/question";
import type { VoiceMode } from "@/lib/voice/start";
import { submitTypedAnswer, TypedAnswerRefused } from "@/lib/voice/typed";
import { currentLearner } from "@/lib/session/current";

export const dynamic = "force-dynamic";

const MODES: VoiceMode[] = ["guided", "unguided", "pressure"];

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { mode?: string; question?: string; text?: string };
    const mode = MODES.find((candidate) => candidate === body.mode);
    if (!mode || typeof body.question !== "string" || typeof body.text !== "string") {
      return NextResponse.json(
        { message: "Send the mode, the question and your answer. Nothing was saved." },
        { status: 400 },
      );
    }

    const learner = await currentLearner();
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
    throw error;
  }
}
