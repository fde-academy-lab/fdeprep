import { NextResponse } from "next/server";
import { saveAttemptNote } from "@/lib/attempts/actions";
import { currentLearner } from "@/lib/session/current";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const learner = await currentLearner();
  const { note } = (await request.json()) as { note?: string };
  return NextResponse.json(await saveAttemptNote({
    enrolmentId: learner.enrolmentId, cohortId: learner.cohortId,
    problemId: Number(id), note: String(note ?? ""),
  }));
}
