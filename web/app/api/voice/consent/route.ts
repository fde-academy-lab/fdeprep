/** Grant or withdraw recording consent. docs/07 section 9. */
import { NextResponse } from "next/server";
import { consentState, grantConsent, revokeConsent } from "@/lib/voice/consent";
import { currentLearner } from "@/lib/session/current";

export const dynamic = "force-dynamic";

export async function GET() {
  const learner = await currentLearner();
  return NextResponse.json(await consentState(learner.enrolmentId));
}

export async function POST() {
  // The enrolment comes from the session, never from the body. A consent row
  // a browser could name is a consent row anyone can write.
  const learner = await currentLearner();
  return NextResponse.json(await grantConsent(learner.enrolmentId));
}

export async function DELETE() {
  const learner = await currentLearner();
  await revokeConsent(learner.enrolmentId);
  return NextResponse.json({ granted: false, grantedAt: null });
}
