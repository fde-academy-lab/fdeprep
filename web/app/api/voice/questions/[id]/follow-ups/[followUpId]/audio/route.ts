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
import { ensureFollowUpAudio, followUpAudio } from "@/lib/voice/tts";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; followUpId: string }> },
) {
  const { id, followUpId } = await params;
  const questionId = Number(id);

  await ensureFollowUpAudio(questionId);
  const audio = await followUpAudio(questionId, Number(followUpId));

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
      // The object never changes for a given follow-up, and a new follow-up
      // gets a new id.
      "cache-control": "private, max-age=86400",
    },
  });
}
