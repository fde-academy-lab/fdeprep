/** Share one session's recording with faculty, or withdraw it. docs/07 section 9. */
import { NextResponse } from "next/server";
import { jsonBody, signedOut, unexpected } from "@/lib/http/failure";
import { AudioForbidden, setShare } from "@/lib/voice/audio";
import { learnerOrNull } from "@/lib/session/current";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const learner = await learnerOrNull();
    if (!learner) return signedOut();
    const body = await jsonBody<{ shared?: unknown }>(request);
    // A garbled request changes nothing, rather than reading as a withdrawal.
    if (typeof body?.shared !== "boolean") {
      return NextResponse.json(
        { message: "Send shared as true or false. Nothing changed." }, { status: 400 });
    }
    await setShare({
      sessionId: Number(id),
      enrolmentId: learner.enrolmentId,
      shared: body.shared,
    });
    return NextResponse.json({ shared: body.shared });
  } catch (error) {
    if (error instanceof AudioForbidden) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return unexpected(`sharing voice session ${id}`, error,
      "Sharing did not change because the server hit an error. Try again in a minute.");
  }
}
