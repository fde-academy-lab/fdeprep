import { NextResponse } from "next/server";
import {
  createSubmission, DuplicateSubmissionError, GateRefused, RateLimitError, type RunKind,
} from "@/lib/submissions/create";
import { dispatchOnce } from "@/lib/queue/dispatcher";
import { currentLearner } from "@/lib/session/current";

// An allowlist rather than a cast. The client names which kind it wants and
// the server decides whether that kind is allowed right now: every gate behind
// these is re-resolved in createSubmission. A kind not on this list is a run.
const KINDS = new Set<RunKind>(["run", "submit", "defence", "rehearsal_submit"]);

export async function POST(request: Request) {
  const learner = await currentLearner();
  const payload = (await request.json()) as
    { problemId?: number; kind?: RunKind; body?: string; rehearsalId?: number | null };

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
      kind: payload.kind && KINDS.has(payload.kind) ? payload.kind : "run",
      body: payload.body,
      // Checked against the learner's own sittings in createSubmission's
      // policy resolution, so a made-up id changes nothing.
      rehearsalId: payload.rehearsalId ?? undefined,
    });

    // Nudge the dispatcher so a local run does not wait for the next tick. The
    // deployed dispatcher runs on its own schedule and this is a no-op there.
    //
    // Awaited, not fired and forgotten. An un-awaited dispatch outlives the
    // request that started it, and anything that then touches outbox, a test's
    // truncate included, deadlocks against a transaction nobody is holding a
    // handle to. Awaiting also makes the 202 mean the message is queued rather
    // than probably queued. The cost is one bounded batch of queries.
    await dispatchOnce().catch(() => {});

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
