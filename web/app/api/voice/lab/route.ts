/**
 * Open a socket session for the transport test page.
 *
 * The browser gets a URL and a token that expires in a minute. It supplies
 * nothing: the enrolment comes from the session, the question from the lab
 * fixture, the mode is fixed, and the socket address is configuration.
 */
import { NextResponse } from "next/server";
import { ConsentRequired } from "@/lib/voice/consent";
import { labQuestionId } from "@/lib/voice/lab";
import { startVoiceSession, VoiceNotConfigured } from "@/lib/voice/start";
import { currentLearner } from "@/lib/session/current";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const learner = await currentLearner();
    // The transport check is for whoever runs the platform, like its page.
    if (learner.role === "learner") {
      return NextResponse.json(
        { message: "The transport check is for faculty. Open the Voice Screen from the header instead." },
        { status: 404 });
    }
    const started = await startVoiceSession({
      enrolmentId: learner.enrolmentId,
      cohortId: learner.cohortId,
      voiceQuestionId: await labQuestionId(),
      mode: "unguided",
      // A transport check carries no answer, so it spends no learner cap.
      capped: false,
    });
    return NextResponse.json(started);
  } catch (error) {
    if (error instanceof ConsentRequired || error instanceof VoiceNotConfigured) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    throw error;
  }
}
