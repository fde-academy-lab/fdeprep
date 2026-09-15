/**
 * The consent screen. docs/07 section 9.
 *
 * One screen, plain words, an explicit accept, and no session before the row
 * exists. The closing paragraph of that section is the reason this screen is
 * written the way it is: a learner who is unsure who is listening will not
 * speak freely, and an interview simulator where nobody speaks freely
 * measures nothing.
 */
import Link from "next/link";
import { consentState } from "@/lib/voice/consent";
import { currentLearner } from "@/lib/session/current";
import { ConsentControls } from "./controls";

export const dynamic = "force-dynamic";

const TERMS: { heading: string; body: string }[] = [
  {
    heading: "What is recorded",
    body:
      "Your answer, as audio, from the moment you start until you stop. The audio is " +
      "transcribed while you speak so the cockpit can show you where you are in the answer. " +
      "Nothing is recorded outside a session you started.",
  },
  {
    heading: "How long the audio is kept",
    body:
      "Thirty days, then it is deleted. Your transcript and your scores stay after the audio " +
      "is gone, so your progress does not disappear with the recording.",
  },
  {
    heading: "Deleting a recording yourself",
    body:
      "Every past session has a delete button. Deletion is immediate and cannot be undone. " +
      "The score for that session stays.",
  },
  {
    heading: "Who can hear it",
    body:
      "Faculty see your transcripts and your scores. Faculty cannot hear a recording unless " +
      "you share that session with them, one session at a time.",
  },
  {
    heading: "Where the audio goes",
    body:
      "Into storage on the platform's own cloud account. The speech-to-text service " +
      "transcribes it and nothing else receives it.",
  },
];

export default async function VoiceConsentPage() {
  const learner = await currentLearner();
  const state = await consentState(learner.enrolmentId);

  return (
    <main className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="text-xl font-semibold">Recording your spoken answers</h1>
      <p className="mt-2 text-text-dim">
        The Voice Screen records you speaking. Read this once and accept, and you will not be
        asked again.
      </p>

      <dl className="mt-6 divide-y divide-border border-y border-border">
        {TERMS.map((term) => (
          <div key={term.heading} className="py-4">
            <dt className="font-medium">{term.heading}</dt>
            <dd className="mt-1 text-text-dim">{term.body}</dd>
          </div>
        ))}
      </dl>

      <ConsentControls
        granted={state.granted}
        grantedAt={state.grantedAt ? state.grantedAt.toISOString() : null}
      />

      {state.granted && (
        <p className="mt-6 text-text-dim">
          Next: <Link href="/voice/lab" className="text-accent">check your microphone</Link>.
        </p>
      )}
    </main>
  );
}
