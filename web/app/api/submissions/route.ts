import { NextResponse } from "next/server";
import {
  createSubmission, DuplicateSubmissionError, GateRefused, RateLimitError, type RunKind,
} from "@/lib/submissions/create";
import { dispatchOnce } from "@/lib/queue/dispatcher";
import { currentLearner } from "@/lib/session/current";

export async function POST(request: Request) {
  const learner = await currentLearner();
  const payload = (await request.json()) as { problemId?: number; kind?: RunKind; body?: string };

  if (!payload.problemId || typeof payload.body !== "string") {
    return NextResponse.json(
      { message: "The request needs a problemId and a body." }, { status: 400 });
  }

  try {
    // The enrolment comes from the session, never from the client. docs/03
    // section 9.1: the browser may not supply a cap allowance or an identity.
    const submission = await createSubmission({
      enrolmentId: learner.enrolmentId,
      cohortId: learner.cohortId,
      problemId: payload.problemId,
      kind: payload.kind === "submit" ? "submit" : "run",
      body: payload.body,
    });

    // Nudge the dispatcher so a local run does not wait for the next tick. The
    // deployed dispatcher runs on its own schedule and this is a no-op there.
    void dispatchOnce().catch(() => {});

    return NextResponse.json({ id: submission.id }, { status: 202 });
  } catch (error) {
    if (error instanceof RateLimitError) {
      return NextResponse.json({ message: error.message }, { status: 429 });
    }
    if (error instanceof DuplicateSubmissionError || error instanceof GateRefused) {
      return NextResponse.json({ message: error.message }, { status: 409 });
    }
    throw error;
  }
}
