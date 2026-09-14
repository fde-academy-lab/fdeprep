import { NextResponse } from "next/server";
import { GateError, revealHint } from "@/lib/attempts/actions";
import { currentLearner } from "@/lib/session/current";

export async function POST(_r: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const learner = await currentLearner();
  try {
    return NextResponse.json(await revealHint({
      enrolmentId: learner.enrolmentId, cohortId: learner.cohortId, problemId: Number(id),
    }));
  } catch (error) {
    if (error instanceof GateError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    throw error;
  }
}
