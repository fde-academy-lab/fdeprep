import { NextResponse } from "next/server";
import { resolvePolicy } from "@/lib/policy";
import { signedOut } from "@/lib/http/failure";
import { learnerOrNull } from "@/lib/session/current";

/** Everything the workspace needs to render itself, in one answer. */
export async function GET(_r: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const learner = await learnerOrNull();
  if (!learner) return signedOut();
  return NextResponse.json(
    await resolvePolicy({ enrolmentId: learner.enrolmentId, problemId: Number(id) }));
}
