/** Share one session's recording with faculty, or withdraw it. docs/07 section 9. */
import { NextResponse } from "next/server";
import { AudioForbidden, setShare } from "@/lib/voice/audio";
import { currentLearner } from "@/lib/session/current";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const learner = await currentLearner();
    const { id } = await params;
    const body = (await request.json()) as { shared?: boolean };
    await setShare({
      sessionId: Number(id),
      enrolmentId: learner.enrolmentId,
      shared: body.shared === true,
    });
    return NextResponse.json({ shared: body.shared === true });
  } catch (error) {
    if (error instanceof AudioForbidden) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    throw error;
  }
}
