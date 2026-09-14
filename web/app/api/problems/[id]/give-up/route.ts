import { NextResponse } from "next/server";
import { GateError, giveUp, referenceWalkthrough } from "@/lib/attempts/actions";
import { currentLearner } from "@/lib/session/current";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const learner = await currentLearner();
  const { reason } = (await request.json().catch(() => ({}))) as { reason?: string };
  try {
    await giveUp({
      enrolmentId: learner.enrolmentId, cohortId: learner.cohortId,
      problemId: Number(id), reason,
    });
    return NextResponse.json(await referenceWalkthrough({
      enrolmentId: learner.enrolmentId, problemId: Number(id),
    }));
  } catch (error) {
    if (error instanceof GateError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    throw error;
  }
}
