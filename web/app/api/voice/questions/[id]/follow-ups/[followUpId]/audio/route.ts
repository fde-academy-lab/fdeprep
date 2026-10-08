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
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db/pool";
import { learnerOrNull } from "@/lib/session/current";
import { InterviewerNotFound, resolveInterviewer, speakingVoice } from "@/lib/voice/interviewers";
import { ensureFollowUpAudio, followUpAudio, spokenLineAudio } from "@/lib/voice/tts";

export const dynamic = "force-dynamic";

/** The follow-up in the chosen interviewer's voice, or null when there is no
 *  such follow-up or no speech is configured. */
async function inInterviewersVoice(questionId: number, followUpId: number, slug: string) {
  const interviewer = await resolveInterviewer(slug);
  const { rows } = await db().query<{ text: string }>(
    `select text from voice_follow_up
      where id = $1 and voice_question_id = $2 and retired_at is null`,
    [followUpId, questionId]);
  const voice = await speakingVoice(interviewer);
  if (!rows[0] || !voice) return null;
  return spokenLineAudio(rows[0].text, voice);
}

export async function GET(
  request: Request,
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
  const interviewer = new URL(request.url).searchParams.get("interviewer");

  let audio: Awaited<ReturnType<typeof followUpAudio>>;
  try {
    if (interviewer) {
      audio = await inInterviewersVoice(questionId, Number(followUpId), interviewer);
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
