/**
 * A question, or an interviewer's opening line, in that interviewer's voice.
 * docs/07 section 2a.
 *
 * The browser names a question, an interviewer and which of the two lines,
 * and nothing else: the words come from the question row and the interviewer
 * row, and the voice from the interviewer, or on the panel from its chair.
 * Synthesised on the first request and cached once per voice and text in
 * voice_spoken_line, so every later learner hears the same object.
 *
 * The bucket and the key stay on the server and the bytes are streamed, as
 * the follow-up audio route does, so no storage address reaches a browser.
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db/pool";
import { learnerOrNull } from "@/lib/session/current";
import { InterviewerNotFound, resolveInterviewer, speakingVoice } from "@/lib/voice/interviewers";
import { spokenLineAudio } from "@/lib/voice/tts";

export const dynamic = "force-dynamic";

const LINES = ["prompt", "opening"] as const;

function missing(message: string): NextResponse {
  return NextResponse.json({ message }, { status: 404 });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; interviewer: string; line: string }> },
) {
  // The proxy only checks that a cookie is present. This is the check that
  // the cookie is real, and it comes before anything that could call Polly.
  if (!(await learnerOrNull())) {
    return NextResponse.json(
      { message: "Your session has ended. Sign in again to continue." }, { status: 401 });
  }
  const { id, interviewer: slug, line } = await params;
  const questionId = Number(id);
  if (!(LINES as readonly string[]).includes(line) || !Number.isSafeInteger(questionId)) {
    return missing("There is no such line to speak. The question is written on the page.");
  }

  let audio: Awaited<ReturnType<typeof spokenLineAudio>>;
  try {
    const interviewer = await resolveInterviewer(slug);
    const { rows } = await db().query<{ prompt_text: string }>(
      "select prompt_text from voice_question where id = $1 and is_published", [questionId]);
    if (!rows[0]) return missing("That question is not published any more. Pick another from the Voice page.");
    const text = line === "prompt" ? rows[0].prompt_text : interviewer.openingLine;
    const voice = await speakingVoice(interviewer);
    audio = voice ? await spokenLineAudio(text, voice) : null;
  } catch (error) {
    if (error instanceof InterviewerNotFound) {
      return missing("That interviewer is not available any more. Pick another above the question.");
    }
    // Polly or the bucket failed. The lobby shows the words whatever this
    // answers, so the learner still reads the question.
    console.error(`speech for question ${questionId}, ${slug}, ${line} failed:`, error);
    return NextResponse.json(
      { message: "The line could not be spoken. It is written on the page instead." },
      { status: 503 });
  }

  if (!audio) {
    return missing("No speech is configured on this deployment, so the line is written on the page.");
  }
  return new NextResponse(audio.body as BodyInit, {
    headers: {
      "content-type": audio.contentType,
      // Revalidated on every use: the address stays the same when the words
      // change on a re-import, and a day of browser cache would play the old
      // line.
      "cache-control": "private, no-cache",
    },
  });
}
