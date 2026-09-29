/**
 * The Voice Screen, in whichever mode the link asked for.
 *
 * The mode is read from the query string and checked against the three the
 * spec names. It decides what the cockpit draws and nothing else: the caps,
 * the consent gate and the question are all resolved server-side when the
 * session opens, so a learner editing the URL changes the instruments they
 * see and not what they are allowed to do.
 *
 * Three ways in, and none of them a dead end. Graded sessions need the voice
 * socket; where it is not deployed the page offers timed practice that records
 * nothing, and tells faculty exactly what is missing. Where it is deployed,
 * consent comes first, then the cockpit.
 */
import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft, Mic, ShieldCheck, Wrench } from "lucide-react";
import { consentState } from "@/lib/voice/consent";
import { currentLearner } from "@/lib/session/current";
import { fixtureQuestionId } from "@/lib/voice/fixture";
import { beatsAreAPathway, loadQuestion, publishedQuestionId } from "@/lib/voice/question";
import { voiceReadiness, type VoiceMode } from "@/lib/voice/start";
import { LogoMark } from "@/components/ui/logo";
import { ButtonLink } from "@/components/ui/button";
import { VoicePractice } from "@/components/voice/practice";
import { cn } from "@/components/ui/cn";
import { Cockpit } from "./cockpit";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Voice practice" };

const MODES: VoiceMode[] = ["guided", "unguided", "pressure"];

const BLURB: Record<VoiceMode, string> = {
  guided: "Five instruments. The beat track is the one to watch.",
  unguided: "The question, the clock and a microphone. The instruments come back in the debrief.",
  pressure: "Guided, and the interviewer interrupts twice.",
};

type Params = Record<string, string | string[] | undefined>;

export default async function VoiceSessionPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const asked = Array.isArray(params.mode) ? params.mode[0] : params.mode;
  const mode = MODES.find((candidate) => candidate === asked) ?? "guided";
  const slug = Array.isArray(params.q) ? params.q[0] : params.q;

  const learner = await currentLearner();
  const { granted } = await consentState(learner.enrolmentId);
  // An authored question when the content has been imported, and the docs/07
  // fixture only when it has not, which is every fresh checkout before
  // `npm run import:content` has run.
  const chosen = await publishedQuestionId(slug);
  const question = await loadQuestion(chosen ?? await fixtureQuestionId());
  const readiness = voiceReadiness();
  const staff = learner.role !== "learner";

  return (
    <div className="min-h-dvh">
      <header className="flex h-12 items-center gap-3 border-b border-border px-3">
        <Link href="/" aria-label="FDE Prep home"><LogoMark /></Link>
        <Link href="/" className="inline-flex items-center gap-1.5 text-text-dim hover:text-text">
          <ArrowLeft aria-hidden className="size-4" /> Home
        </Link>
        <span className="ml-auto text-meta text-text-faint">{question.title}</span>
      </header>

      <main className="mx-auto max-w-3xl px-5 pb-16 pt-10">
        {!readiness.ready ? (
          <>
            <p className="inline-flex items-center gap-2 rounded-full border border-border-strong px-3 py-1
                          text-meta text-text-dim">
              <Mic aria-hidden className="size-3.5" /> Timed practice
            </p>
            <h1 className="mt-4 text-display font-semibold tracking-[-0.02em] text-text">
              Answer it out loud against the clock
            </h1>
            <p className="mt-3 text-text-dim">
              Graded voice sessions are not switched on for this cohort yet, so this run records
              nothing and scores nothing. The clock and the beats are the same ones a graded
              session uses.
            </p>
            <div className="mt-8 rounded-panel border border-border bg-surface p-5 sm:p-6">
              <VoicePractice prompt={question.promptText} totalSeconds={question.totalSeconds}
                             beats={question.beats.map((b) => ({ key: b.key, label: b.label, seconds: b.seconds }))} />
            </div>
            {staff ? (
              <details className="mt-6 rounded-panel border border-border bg-surface px-4 py-3">
                <summary className="flex cursor-pointer items-center gap-2 text-text">
                  <Wrench aria-hidden className="size-4 text-text-dim" /> What faculty need to switch graded voice on
                </summary>
                <p className="mt-2 text-text-dim">
                  The web app needs {readiness.missing.map((name, i) => (
                    <span key={name}>{i ? " and " : ""}<code className="font-mono text-text">{name}</code></span>
                  ))}. Both come from the voice stack in <code className="font-mono text-text">infra/</code>;
                  docs/05 has the deploy steps, and a human runs the deploy.
                </p>
              </details>
            ) : null}
          </>
        ) : !granted ? (
          <div className="rounded-panel border border-border bg-surface p-6">
            <ShieldCheck aria-hidden className="size-6 text-text-dim" strokeWidth={1.75} />
            <h1 className="mt-3 text-title font-semibold text-text">Recording needs your consent first</h1>
            <p className="mt-2 text-text-dim">
              A graded session records your audio so the debrief can play it back. Read what is kept,
              for how long and who can hear it, then accept or leave.
            </p>
            <div className="mt-5 flex flex-wrap gap-2.5">
              <ButtonLink href="/voice/consent" variant="primary">Read what is recorded</ButtonLink>
              <ButtonLink href="/" variant="ghost">Not now</ButtonLink>
            </div>
          </div>
        ) : (
          <>
            <nav aria-label="Mode" className="flex flex-wrap gap-1.5">
              {MODES.map((candidate) => (
                <Link key={candidate} href={{ pathname: "/voice/session", query: { mode: candidate } }}
                      aria-current={candidate === mode ? "page" : undefined}
                      className={cn("rounded-full border px-3 py-1 font-medium capitalize",
                                    candidate === mode ? "border-text bg-text text-bg"
                                      : "border-border-strong text-text-dim hover:text-text")}>
                  {candidate}
                </Link>
              ))}
            </nav>
            <p className="mt-3 text-text-dim">{BLURB[mode]}</p>

            {beatsAreAPathway(question.beats) ? null : (
              <p className="mt-4 rounded-control border border-warn/40 bg-warn-soft px-3 py-2 text-text">
                This question has {question.beats.length} beats. docs/07 asks for four to six: three is
                not a pathway and seven is a script.
              </p>
            )}

            <Cockpit question={question} mode={mode} />
          </>
        )}
      </main>
    </div>
  );
}
