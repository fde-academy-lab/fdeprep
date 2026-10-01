/**
 * Stream a cached follow-up recording.
 *
 * The bucket and the key stay on the server: the browser is given a path on
 * this application and the object arrives through it, so no storage address
 * reaches a client. docs/07 section 9 is about learner audio rather than
 * this, and the same reasoning holds for anything in the bucket.
 *
 * Synthesis happens here on the first request and never again, which is what
 * "generate once per question and cache" means in practice.
 */
import { NextResponse } from "next/server";
import { learnerOrNull } from "@/lib/session/current";
import { ensureFollowUpAudio, followUpAudio } from "@/lib/voice/tts";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; followUpId: string }> },
) {
  // The proxy only checks that a cookie is present. This is the check that
  // the cookie is real, and it comes before anything that could call Polly.
  if (!(await learnerOrNull())) {
    return NextResponse.json(
      { message: "Your session has ended. Sign in again to continue." }, { status: 401 });
  }
  const { id, followUpId } = await params;
  const questionId = Number(id);

  let audio: Awaited<ReturnType<typeof followUpAudio>>;
  try {
    await ensureFollowUpAudio(questionId);
    audio = await followUpAudio(questionId, Number(followUpId));
  } catch (error) {
    // Polly or the bucket failed. The cockpit shows the follow-up as text
    // whatever this answers, so the interruption still lands.
    console.error(`follow-up audio for question ${questionId} failed:`, error);
    return NextResponse.json(
      { message: "The follow-up could not be spoken. It is shown as text instead." },
      { status: 503 },
    );
  }

  if (!audio) {
    return NextResponse.json(
      {
        message:
          "No recording for that follow-up. Set VOICE_AUDIO_BUCKET and the cockpit will " +
          "synthesise one; until then the follow-up is shown as text.",
      },
      { status: 404 },
    );
  }

  return new NextResponse(audio.body as BodyInit, {
    headers: {
      "content-type": audio.contentType,
      // Revalidated on every use. A follow-up keeps its id when its words
      // change on a re-import, and the object under that id is synthesised
      // again, so a day of browser cache would play the old line.
      "cache-control": "private, no-cache",
    },
  });
}
