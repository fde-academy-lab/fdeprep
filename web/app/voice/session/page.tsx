/**
 * The Voice Screen, in whichever mode the link asked for.
 *
 * The mode is read from the query string and checked against the three the
 * spec names. It decides what the cockpit draws and nothing else: the caps,
 * the consent gate and the question are all resolved server-side when the
 * session opens, so a learner editing the URL changes the instruments they
 * see and not what they are allowed to do.
 */
import Link from "next/link";
import { consentState } from "@/lib/voice/consent";
import { currentLearner } from "@/lib/session/current";
import { fixtureQuestionId } from "@/lib/voice/fixture";
import { beatsAreAPathway, loadQuestion } from "@/lib/voice/question";
import type { VoiceMode } from "@/lib/voice/start";
import { Cockpit } from "./cockpit";

export const dynamic = "force-dynamic";

const MODES: VoiceMode[] = ["guided", "unguided", "pressure"];

const BLURB: Record<VoiceMode, string> = {
  guided: "Five instruments. The beat track is the one to watch.",
  unguided: "The question, the clock and a microphone. The instruments come back in the debrief.",
  pressure: "Guided, and the interviewer interrupts twice.",
};

type Params = Record<string, string | string[] | undefined>;

export default async function VoiceSessionPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const params = await searchParams;
  const asked = Array.isArray(params.mode) ? params.mode[0] : params.mode;
  const mode = MODES.find((candidate) => candidate === asked) ?? "guided";

  const learner = await currentLearner();
  const { granted } = await consentState(learner.enrolmentId);
  const question = await loadQuestion(await fixtureQuestionId());

  if (!granted) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-8">
        <h1 className="text-xl font-semibold">Voice Screen</h1>
        <p className="mt-6 border border-border bg-surface p-6 text-text-dim">
          No session starts without recording consent.{" "}
          <Link href="/voice/consent" className="text-accent">
            Read what is recorded and accept
          </Link>
          .
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <nav className="flex gap-2 text-text-dim">
        {MODES.map((candidate) => (
          <Link
            key={candidate}
            href={{ pathname: "/voice/session", query: { mode: candidate } }}
            aria-current={candidate === mode ? "page" : undefined}
            className={`rounded border px-2 py-0.5 capitalize ${
              candidate === mode ? "border-accent text-accent" : "border-border hover:text-text"
            }`}
          >
            {candidate}
          </Link>
        ))}
      </nav>
      <p className="mt-3 text-text-dim">{BLURB[mode]}</p>

      {beatsAreAPathway(question.beats) ? null : (
        <p className="mt-4 border border-warn px-3 py-2 text-warn">
          This question has {question.beats.length} beats. docs/07 asks for four to six: three is
          not a pathway and seven is a script.
        </p>
      )}

      <Cockpit question={question} mode={mode} />
    </main>
  );
}
