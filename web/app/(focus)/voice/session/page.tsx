/**
 * The Voice Screen, in whichever mode the link asked for.
 *
 * The mode is read from the query string and checked against the three the
 * spec names. It decides what the cockpit draws and nothing else: the caps,
 * the consent gate and the question are all resolved server-side when the
 * session opens, so a learner editing the URL changes the instruments they
 * see and not what they are allowed to do.
 *
 * Four ways in, and none of them a dead end. Graded sessions need the voice
 * socket; where it is not deployed the page offers timed practice that records
 * nothing, and tells faculty exactly what is missing. Where it is deployed,
 * consent comes first, then the cockpit. A typed answer needs neither, so it
 * is offered from every one of them.
 *
 * The question is the one the link names, resolved to a published question
 * here and again by the session route. A link with no question, or one that
 * names a question no longer published, goes to the picker.
 */
import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ArrowLeft, Keyboard, Mic, ShieldCheck, Wrench } from "lucide-react";
import { consentState } from "@/lib/voice/consent";
import { currentLearner } from "@/lib/session/current";
import {
  beatsAreAPathway, loadQuestion, nextQuestionSlug, publishedQuestions, QuestionNotFound,
  resolvePublishedQuestion,
} from "@/lib/voice/question";
import { voiceReadiness, type VoiceMode } from "@/lib/voice/start";
import { typedWordLimit } from "@/lib/voice/typed";
import { LogoMark } from "@/components/ui/logo";
import { ButtonLink } from "@/components/ui/button";
import { VoicePractice } from "@/components/voice/practice";
import { cn } from "@/components/ui/cn";
import { Cockpit } from "./cockpit";
import { TypedAnswer } from "./typed-answer";

export const dynamic = "force-dynamic";

const MODES: VoiceMode[] = ["guided", "unguided", "pressure"];

const BLURB: Record<VoiceMode, string> = {
  guided: "Five instruments. The beat track is the one to watch.",
  unguided: "The question, the clock and a microphone. The instruments come back in the debrief.",
  pressure: "Guided, and the interviewer interrupts twice.",
};

type Params = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** The question's title, or Voice for a link the page sends back to the picker. */
export async function generateMetadata(
  { searchParams }: { searchParams: Promise<Params> },
): Promise<Metadata> {
  const slug = first((await searchParams).q);
  const question = (await publishedQuestions()).find((candidate) => candidate.slug === slug);
  return { title: question?.title ?? "Voice" };
}

async function questionFor(slug: string | undefined) {
  if (!slug) redirect("/voice");
  try {
    return await loadQuestion(await resolvePublishedQuestion(slug));
  } catch (error) {
    if (error instanceof QuestionNotFound) redirect("/voice");
    throw error;
  }
}

export default async function VoiceSessionPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const asked = first(params.mode);
  const requested = MODES.find((candidate) => candidate === asked) ?? "guided";
  const typed = first(params.input) === "typed";

  const learner = await currentLearner();
  const question = await questionFor(first(params.q));
  // Pressure with nothing to interrupt with is guided mode spending the
  // weekly rehearsal allowance, so a question with no follow-ups is guided.
  const mode = requested === "pressure" && question.followUps.length === 0 ? "guided" : requested;
  const [{ granted }, next] = await Promise.all([
    consentState(learner.enrolmentId), nextQuestionSlug(question.slug),
  ]);
  const readiness = voiceReadiness();
  const staff = learner.role !== "learner";
  // Pressure is an interviewer cutting in out loud, so a typed pressure
  // answer is a guided one.
  const typedMode = mode === "pressure" ? "guided" : mode;
  const typeInstead = (
    <ButtonLink href={{ pathname: "/voice/session", query: { q: question.slug, mode: typedMode, input: "typed" } }}
                variant="ghost" size="sm">
      <Keyboard aria-hidden /> Type the answer instead
    </ButtonLink>
  );

  return (
    <div className="min-h-dvh">
      <header className="flex h-12 items-center gap-3 border-b border-border px-3">
        <Link href="/" aria-label="FDE Prep home"><LogoMark /></Link>
        <Link href="/voice" className="inline-flex items-center gap-1.5 text-text-dim hover:text-text">
          <ArrowLeft aria-hidden className="size-4" /> All questions
        </Link>
        <span className="ml-auto text-meta text-text-faint">{question.title}</span>
      </header>

      <main className="mx-auto max-w-3xl px-5 pb-16 pt-10">
        {typed ? (
          <>
            <p className="inline-flex items-center gap-2 rounded-full border border-border-strong px-3 py-1
                          text-meta text-text-dim">
              <Keyboard aria-hidden className="size-3.5" /> Typed answer, {typedMode}
            </p>
            <h1 className="mt-4 text-display font-semibold tracking-[-0.02em] text-text">{question.title}</h1>
            {mode === "pressure" ? (
              <p className="mt-3 text-text-dim">
                Pressure needs a spoken answer, because the interviewer interrupts out loud. This
                one is guided instead.
              </p>
            ) : null}
            <TypedAnswer key={`${question.slug}:${typedMode}`} question={question} mode={typedMode}
                         wordLimit={typedWordLimit(question.totalSeconds)} />
          </>
        ) : !readiness.ready ? (
          <>
            <p className="inline-flex items-center gap-2 rounded-full border border-border-strong px-3 py-1
                          text-meta text-text-dim">
              <Mic aria-hidden className="size-3.5" /> Timed practice
            </p>
            <h1 className="mt-4 text-display font-semibold tracking-[-0.02em] text-text">{question.title}</h1>
            <p className="mt-2 text-lead text-text-dim">Answer it out loud against the clock.</p>
            <p className="mt-3 text-text-dim">
              Graded voice sessions are not switched on for this cohort yet, so this run records
              nothing and scores nothing. The clock and the beats are the same ones a graded
              session uses.
            </p>
            <div className="mt-8 rounded-panel border border-border bg-surface p-5 sm:p-6">
              <VoicePractice key={question.slug} prompt={question.promptText} totalSeconds={question.totalSeconds}
                             beats={question.beats.map((b) => ({ key: b.key, label: b.label, seconds: b.seconds }))} />
            </div>
            <p className="mt-4 flex flex-wrap items-center gap-2 text-text-dim">
              A typed answer is scored now. {typeInstead}
            </p>
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
          <>
            <h1 className="text-display font-semibold tracking-[-0.02em] text-text">{question.title}</h1>
            <p className="mt-2 text-lead text-text-dim">Answer it out loud against the clock.</p>
            <div className="mt-8 rounded-panel border border-border bg-surface p-6">
              <ShieldCheck aria-hidden className="size-6 text-text-dim" strokeWidth={1.75} />
              <h2 className="mt-3 text-title font-semibold text-text">Recording needs your consent first</h2>
              <p className="mt-2 text-text-dim">
                A graded session records your audio so the debrief can play it back. Read what is kept,
                for how long and who can hear it, then accept or leave.
              </p>
              <div className="mt-5 flex flex-wrap gap-2.5">
                <ButtonLink href="/voice/consent" variant="primary">Read what is recorded</ButtonLink>
                {typeInstead}
                <ButtonLink href="/voice" variant="ghost">Not now</ButtonLink>
              </div>
            </div>
          </>
        ) : (
          /* Keyed so a new question or mode is a new cockpit. Its refs hold
             the session, the transcript and the follow-ups already fired, and
             a cockpit reused across questions carried all three over. The
             lobby is drawn by the cockpit only while no answer is running, so
             the mode links are not a sixth thing on screen mid-answer. */
          <Cockpit key={`${question.slug}:${mode}`} question={question} mode={mode}
                   nextSlug={next !== question.slug ? next : null}
                   lobby={
                     <>
                       <nav aria-label="Mode" className="flex flex-wrap items-center gap-1.5">
                         {MODES.filter((candidate) => candidate !== "pressure" || question.followUps.length > 0)
                           .map((candidate) => (
                           <Link key={candidate}
                                 href={{ pathname: "/voice/session", query: { q: question.slug, mode: candidate } }}
                                 aria-current={candidate === mode ? "page" : undefined}
                                 className={cn("rounded-full border px-3 py-1 font-medium capitalize",
                                               candidate === mode ? "border-text bg-text text-bg"
                                                 : "border-border-strong text-text-dim hover:text-text")}>
                             {candidate}
                           </Link>
                         ))}
                         <span className="ml-auto">{typeInstead}</span>
                       </nav>
                       <p className="mt-3 text-text-dim">{BLURB[mode]}</p>
                       {beatsAreAPathway(question.beats) ? null : (
                         <p className="mt-4 rounded-control border border-warn/40 bg-warn-soft px-3 py-2 text-text">
                           This question has {question.beats.length} beats. docs/07 asks for four to six: three is
                           not a pathway and seven is a script.
                         </p>
                       )}
                     </>
                   } />
        )}
      </main>
    </div>
  );
}
