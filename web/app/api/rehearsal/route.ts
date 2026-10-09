/** Start a sitting. The enrolment comes from the session, never from the body. */
import { NextResponse } from "next/server";
import { startRehearsal } from "@/lib/rehearsal";
import { RateLimitError } from "@/lib/policy";
import { signedOut } from "@/lib/http/failure";
import { learnerOrNull } from "@/lib/session/current";

export const dynamic = "force-dynamic";

export async function POST() {
  const learner = await learnerOrNull();
  if (!learner) return signedOut();
  try {
    const session = await startRehearsal(learner.enrolmentId);
    return NextResponse.json({ id: session.id }, { status: 201 });
  } catch (error) {
    if (error instanceof RateLimitError) {
      return NextResponse.json({ message: error.message }, { status: 429 });
    }
    return NextResponse.json({ message: (error as Error).message }, { status: 400 });
  }
}
