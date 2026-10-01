/**
 * The recording: store it, hear it, delete it. docs/07 section 9.
 *
 * Every method resolves the reader from the signed-in learner. Nothing here
 * takes an enrolment, a bucket or a key from the request, so a browser cannot
 * name somebody else's recording.
 *
 * Every reply is JSON when it is not audio, failures included, so the cockpit
 * and the debrief controls can say what happened. lib/http/failure.ts says
 * why. None of these touches a score, so none of the failures can cost one.
 */
import { NextResponse } from "next/server";
import { signedOut, unexpected } from "@/lib/http/failure";
import { AudioForbidden, deleteAudio, readAudio, storeAudio } from "@/lib/voice/audio";
import { learnerOrNull } from "@/lib/session/current";

export const dynamic = "force-dynamic";

/** A five minute answer as opus is a couple of megabytes. Ten is generous and
 *  still refuses a body that is not a recording of an answer. */
const MAX_BYTES = 10 * 1024 * 1024;

function refused(error: unknown, where: string, message: string) {
  if (error instanceof AudioForbidden) {
    return NextResponse.json({ message: error.message }, { status: error.status });
  }
  return unexpected(where, error, message);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const learner = await learnerOrNull();
    if (!learner) return signedOut();
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
    return refused(error, `storing the recording of voice session ${id}`,
      "The recording was not stored. Your answer and its score are not affected, and the " +
        "debrief replays the answer on its own clock.");
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const learner = await learnerOrNull();
    if (!learner) return signedOut();
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
    return refused(error, `reading the recording of voice session ${id}`,
      "The recording could not be read. Reload the debrief in a minute; the transcript and " +
        "the score do not depend on it.");
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const learner = await learnerOrNull();
    if (!learner) return signedOut();
    await deleteAudio({ sessionId: Number(id), enrolmentId: learner.enrolmentId });
    // The score is untouched and stays. docs/07 section 9.
    return NextResponse.json({ deleted: Number(id) });
  } catch (error) {
    return refused(error, `deleting the recording of voice session ${id}`,
      "The recording was not deleted because the server hit an error. Try again in a minute.");
  }
}
