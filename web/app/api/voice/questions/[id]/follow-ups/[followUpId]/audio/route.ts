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
 *
 * With ?interviewer=slug the follow-up is spoken in that interviewer's voice,
 * so the interviewer the learner chose is the one who interrupts. That line is
 * cached once per voice and text in voice_spoken_line. Without it the
 * deployment's own voice speaks it, as before, cached on the follow-up row.
 * The slug picks a voice from the server's own list and nothing more.
 *
 * Only a follow-up still in its question's file, on a question that is
 * published, is spoken. An id nobody holds, a question that is not published
 * and a follow-up the file dropped get the same 404, before Polly is asked
 * anything and before anything is cached. Until 9 October 2026 this spoke and
 * cached any question's follow-ups by id (S15.13). The docs give staff no
 * preview of unpublished voice content, so the rule has no exception.
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db/pool";
import { learnerOrNull } from "@/lib/session/current";
import { InterviewerNotFound, resolveInterviewer, speakingVoice } from "@/lib/voice/interviewers";
import { ensureFollowUpAudio, followUpAudio, spokenLineAudio } from "@/lib/voice/tts";

export const dynamic = "force-dynamic";

/** The follow-up's words, when anyone may hear them, or null. */
async function speakable(questionId: number, followUpId: number): Promise<string | null> {
  if (!Number.isSafeInteger(questionId) || !Number.isSafeInteger(followUpId)) return null;
  const { rows } = await db().query<{ text: string }>(
    `select f.text from voice_follow_up f
       join voice_question q on q.id = f.voice_question_id
      where f.id = $1 and f.voice_question_id = $2 and f.retired_at is null and q.is_published`,
    [followUpId, questionId]);
  return rows[0]?.text ?? null;
}

/** The follow-up in the chosen interviewer's voice, or null when no speech is configured. */
async function inInterviewersVoice(text: string, slug: string) {
  const interviewer = await resolveInterviewer(slug);
  const voice = await speakingVoice(interviewer);
  return voice ? spokenLineAudio(text, voice) : null;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; followUpId: string }> },
) {
  // The proxy has checked the cookie's signature. This is the check that it
  // names somebody enrolled, and it comes before anything that could call Polly.
  if (!(await learnerOrNull())) {
    return NextResponse.json(
      { message: "Your session has ended. Sign in again to continue." }, { status: 401 });
  }
  const { id, followUpId } = await params;
  const questionId = Number(id);
  const interviewer = new URL(request.url).searchParams.get("interviewer");

  let audio: Awaited<ReturnType<typeof followUpAudio>>;
  try {
    const text = await speakable(questionId, Number(followUpId));
    if (text === null) {
      return NextResponse.json(
        { message: "That follow-up is not available, so it is shown as text." }, { status: 404 });
    }
    if (interviewer) {
      audio = await inInterviewersVoice(text, interviewer);
    } else {
      await ensureFollowUpAudio(questionId);
      audio = await followUpAudio(questionId, Number(followUpId));
    }
  } catch (error) {
    if (error instanceof InterviewerNotFound) {
      return NextResponse.json(
        { message: "That interviewer is not available any more, so the follow-up is shown as text." },
        { status: 404 });
    }
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
