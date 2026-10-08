/**
 * Stream what the interviewer said in one round. docs/07 sections 5a and 9.
 *
 * A generated follow-up lives under voice/generated/, kept thirty days like
 * the learner's own recording; a fallback line is a cached spoken line. Either
 * way the key stays on the server, and only the learner whose session it is
 * hears it, so the session is checked against their enrolment before anything
 * is read from the bucket.
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db/pool";
import { learnerOrNull } from "@/lib/session/current";
import { storedSpeech } from "@/lib/voice/tts";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request, { params }: { params: Promise<{ id: string; ordinal: string }> },
) {
  const learner = await learnerOrNull();
  if (!learner) {
    return NextResponse.json(
      { message: "Your session has ended. Sign in again to continue." }, { status: 401 });
  }
  const { id, ordinal } = await params;
  const sessionId = Number(id);
  const turn = Number(ordinal);
  if (!Number.isSafeInteger(sessionId) || !Number.isSafeInteger(turn)) {
    return NextResponse.json({ message: "There is no such round." }, { status: 404 });
  }

  const { rows } = await db().query<{ audio_key: string | null }>(
    `select t.audio_key from voice_turn t
       join voice_session s on s.id = t.voice_session_id
      where t.voice_session_id = $1 and t.ordinal = $2 and s.enrolment_id = $3`,
    [sessionId, turn, learner.enrolmentId]);
  const key = rows[0]?.audio_key;
  if (!key) {
    return NextResponse.json(
      { message: "No recording for that round, so its question is written on the screen." },
      { status: 404 });
  }

  let audio: Awaited<ReturnType<typeof storedSpeech>>;
  try {
    audio = await storedSpeech(key);
  } catch (error) {
    console.error(`round ${turn} audio for voice session ${sessionId} failed:`, error);
    return NextResponse.json(
      { message: "The interviewer could not be played. Press Answer now and reply to the question." },
      { status: 503 });
  }
  if (!audio) {
    return NextResponse.json(
      { message: "No recording for that round, so its question is written on the screen." },
      { status: 404 });
  }
  return new NextResponse(audio.body as BodyInit, {
    headers: { "content-type": audio.contentType, "cache-control": "private, no-cache" },
  });
}
