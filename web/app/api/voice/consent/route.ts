/** Grant or withdraw recording consent. docs/07 section 9. */
import { NextResponse } from "next/server";
import { signedOut, unexpected } from "@/lib/http/failure";
import { consentState, grantConsent, revokeConsent } from "@/lib/voice/consent";
import { learnerOrNull } from "@/lib/session/current";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const learner = await learnerOrNull();
    if (!learner) return signedOut();
    return NextResponse.json(await consentState(learner.enrolmentId));
  } catch (error) {
    return unexpected("reading voice consent", error,
      "Your consent could not be read because the server hit an error. Reload in a minute.");
  }
}

export async function POST() {
  try {
    // The enrolment comes from the session, never from the body. A consent row
    // a browser could name is a consent row anyone can write.
    const learner = await learnerOrNull();
    if (!learner) return signedOut();
    return NextResponse.json(await grantConsent(learner.enrolmentId));
  } catch (error) {
    return unexpected("granting voice consent", error,
      "Your consent was not saved because the server hit an error. Press accept again in a minute.");
  }
}

export async function DELETE() {
  try {
    const learner = await learnerOrNull();
    if (!learner) return signedOut();
    await revokeConsent(learner.enrolmentId);
    return NextResponse.json({ granted: false, grantedAt: null });
  } catch (error) {
    return unexpected("withdrawing voice consent", error,
      "Your consent was not withdrawn because the server hit an error. Press withdraw again " +
        "in a minute.");
  }
}
