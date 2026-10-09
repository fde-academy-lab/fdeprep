import { NextResponse } from "next/server";
import { GateError, saveLearnerTest } from "@/lib/attempts/actions";
import { signedOut } from "@/lib/http/failure";
import { learnerOrNull } from "@/lib/session/current";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const learner = await learnerOrNull();
  if (!learner) return signedOut();
  const { body } = (await request.json()) as { body?: string };
  try {
    return NextResponse.json(await saveLearnerTest({
      enrolmentId: learner.enrolmentId, cohortId: learner.cohortId,
      problemId: Number(id), body: String(body ?? ""),
    }));
  } catch (error) {
    if (error instanceof GateError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    throw error;
  }
}
