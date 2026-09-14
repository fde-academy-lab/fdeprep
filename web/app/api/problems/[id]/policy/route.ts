import { NextResponse } from "next/server";
import { resolvePolicy } from "@/lib/policy";
import { currentLearner } from "@/lib/session/current";

/** Everything the workspace needs to render itself, in one answer. */
export async function GET(_r: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const learner = await currentLearner();
  return NextResponse.json(
    await resolvePolicy({ enrolmentId: learner.enrolmentId, problemId: Number(id) }));
}
