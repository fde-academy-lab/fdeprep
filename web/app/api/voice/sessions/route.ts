/**
 * Open a voice session in one of the three modes.
 *
 * The browser sends a mode and nothing else. The enrolment comes from the
 * signed-in learner, the question from the server, the socket address from
 * configuration, and the consent gate refuses before any row is written.
 */
import { NextResponse } from "next/server";
import { ConsentRequired } from "@/lib/voice/consent";
import { fixtureQuestionId } from "@/lib/voice/fixture";
import { startVoiceSession, VoiceNotConfigured, type VoiceMode } from "@/lib/voice/start";
import { currentLearner } from "@/lib/session/current";

export const dynamic = "force-dynamic";

const MODES: VoiceMode[] = ["guided", "unguided", "pressure"];

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { mode?: string };
    const mode = MODES.find((candidate) => candidate === body.mode);
    if (!mode) {
      return NextResponse.json(
        { message: `Pick one of ${MODES.join(", ")}.` },
        { status: 400 },
      );
    }

    const learner = await currentLearner();
    const started = await startVoiceSession({
      enrolmentId: learner.enrolmentId,
      cohortId: learner.cohortId,
      voiceQuestionId: await fixtureQuestionId(),
      mode,
    });
    return NextResponse.json(started);
  } catch (error) {
    if (error instanceof ConsentRequired || error instanceof VoiceNotConfigured) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    throw error;
  }
}
