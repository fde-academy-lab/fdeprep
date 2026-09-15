/**
 * The recording: store it, hear it, delete it. docs/07 section 9.
 *
 * Every method resolves the reader from the signed-in learner. Nothing here
 * takes an enrolment, a bucket or a key from the request, so a browser cannot
 * name somebody else's recording.
 */
import { NextResponse } from "next/server";
import { AudioForbidden, deleteAudio, readAudio, storeAudio } from "@/lib/voice/audio";
import { currentLearner } from "@/lib/session/current";

export const dynamic = "force-dynamic";

/** A five minute answer as opus is a couple of megabytes. Ten is generous and
 *  still refuses a body that is not a recording of an answer. */
const MAX_BYTES = 10 * 1024 * 1024;

function refused(error: unknown) {
  if (error instanceof AudioForbidden) {
    return NextResponse.json({ message: error.message }, { status: error.status });
  }
  throw error;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const learner = await currentLearner();
    const { id } = await params;
    const body = new Uint8Array(await request.arrayBuffer());

    if (body.byteLength === 0) {
      return NextResponse.json({ message: "Nothing to store." }, { status: 400 });
    }
    if (body.byteLength > MAX_BYTES) {
      return NextResponse.json(
        { message: `That recording is over the ${MAX_BYTES} byte limit and was not stored.` },
        { status: 413 },
      );
    }

    const stored = await storeAudio({
      sessionId: Number(id),
      enrolmentId: learner.enrolmentId,
      body,
      contentType: request.headers.get("content-type") ?? "audio/webm",
    });
    return NextResponse.json({ stored });
  } catch (error) {
    return refused(error);
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const learner = await currentLearner();
    const { id } = await params;
    const audio = await readAudio({
      sessionId: Number(id),
      enrolmentId: learner.enrolmentId,
      role: learner.role,
    });

    if (!audio) {
      return NextResponse.json(
        { message: "There is no recording for that session." },
        { status: 404 },
      );
    }
    return new NextResponse(audio.body as BodyInit, {
      headers: { "content-type": audio.contentType, "cache-control": "private, no-store" },
    });
  } catch (error) {
    return refused(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const learner = await currentLearner();
    const { id } = await params;
    await deleteAudio({ sessionId: Number(id), enrolmentId: learner.enrolmentId });
    // The score is untouched and stays. docs/07 section 9.
    return NextResponse.json({ deleted: Number(id) });
  } catch (error) {
    return refused(error);
  }
}
