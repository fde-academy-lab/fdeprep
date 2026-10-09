import { NextResponse } from "next/server";
import { GateError, revealHint } from "@/lib/attempts/actions";
import { signedOut } from "@/lib/http/failure";
import { learnerOrNull } from "@/lib/session/current";

export async function POST(_r: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const learner = await learnerOrNull();
  if (!learner) return signedOut();
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
