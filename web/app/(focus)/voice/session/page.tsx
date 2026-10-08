/**
 * The Voice Screen's start screen, then the session, in whichever mode the
 * learner picks here.
 *
 * The screen opens on the question, its clock and the four ways to answer
 * it, each with what it spends. The mode is read from the query string and
 * checked against the three the spec names. It decides what the cockpit draws
 * and nothing else: the caps, the consent gate and the question are all
 * resolved server-side when the session opens, so a learner editing the URL
 * changes the instruments they see and not what they are allowed to do.
 *
 * Four ways in, and none of them a dead end. Graded sessions need the voice
 * socket; where it is not deployed the page offers timed practice that records
 * nothing, and the server log says what is missing. Where it is deployed,
 * consent comes first, then the cockpit. A typed answer needs neither, so it
 * is on the list in every one of them.
 *
 * The question is the one the link names, resolved to a published question
 * here and again by the session route. A link with no question, or one that
 * names a question no longer published, goes to Voice.
 *
 * Amended 9 October 2026 for S13.4 to S13.6. Above the modes table, and only
 * while no answer runs, the lobby says who asks (the interviewer the link
 * chose, else the question's first), which round of the loop this is and what
 * it tests, the framework card, the tips people overlook, and the problems it
 * builds on. The interviewer is a slug the session route resolves again; the
 * page only decides what to draw.
 */
import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ArrowLeft, Keyboard, ShieldCheck } from "lucide-react";
import { allowanceFor, humanise, voiceScope, type Allowance } from "@/lib/policy/caps";
import { TRACK_NAMES } from "@/lib/problems/vocabulary";
import { isTrack } from "@/components/ui/tracks";
import { consentState } from "@/lib/voice/consent";
import { currentLearner } from "@/lib/session/current";
import { clock } from "@/lib/voice/clock";
import { loadInterviewers, lobbyInterviewer, membersOf, PANEL } from "@/lib/voice/interviewers";
import {
  beatsAreAPathway, loadQuestion, nextQuestionSlug, problemsBuiltOn, publishedQuestions,
  QuestionNotFound, resolvePublishedQuestion, VOICE_TRACK_ORDER, type BuiltOn, type VoiceQuestion,
} from "@/lib/voice/question";
import { isRound, ROUND_LINES, ROUND_NAMES } from "@/lib/voice/rounds";
import {
  interviewRoundsForQuestion, logVoiceNotSetUp, voiceReadiness, type VoiceMode,
} from "@/lib/voice/start";
import { ttsConfig } from "@/lib/voice/tts";
import { typedWordLimit } from "@/lib/voice/typed";
import { LogoMark } from "@/components/ui/logo";
import { ButtonLink } from "@/components/ui/button";
import { InterviewerCard } from "@/components/voice/interviewer-card";
import { InterviewRoom } from "@/components/voice/room/room";
import { VoicePractice } from "@/components/voice/practice";
import { cn } from "@/components/ui/cn";
import { Cockpit } from "./cockpit";
import { TypedAnswer } from "./typed-answer";

export const dynamic = "force-dynamic";

const MODES: VoiceMode[] = ["guided", "unguided", "pressure", "interview"];

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

function left(allowance: Allowance, period: string): string {
  if (allowance.max === null) return "No cap";
  if (allowance.remaining > 0) return `${allowance.remaining} of ${allowance.max} left ${period}`;
  return `None left. More in ${humanise(allowance.resetInS ?? 0)}`;
}

const FRAMEWORK_LINES: Array<{ key: keyof NonNullable<VoiceQuestion["framework"]>; label: string }> = [
  { key: "answerFirst", label: "Answer first" },
  { key: "evidence", label: "Evidence" },
  { key: "tradeOff", label: "The trade-off" },
  { key: "ifYouDoNotKnow", label: "If you do not know" },
];

/**
 * What the question says about its loop and how to answer it: the round, what
 * it tests, the framework card, the tips and what it builds on. docs/07
 * section 2, amended 9 October 2026. A row imported before the fields existed
 * draws none of it.
 */
function Teaching({ question, builtOn }: { question: VoiceQuestion; builtOn: BuiltOn[] }) {
  return (
    <>
      {question.tests ? (
        <section aria-label="What it tests" className="mt-6">
          <h2 className="text-meta font-medium text-text-faint">What it tests</h2>
          <p className="mt-1 max-w-[70ch] text-text">{question.tests}</p>
        </section>
      ) : null}

      {question.framework ? (
        <section aria-label="How to answer it" className="mt-6 rounded-panel border border-border bg-surface p-5">
          <h2 className="text-lead font-semibold text-text">How to answer it</h2>
          <dl className="mt-3 divide-y divide-border">
            {FRAMEWORK_LINES.map(({ key, label }) => (
              <div key={key} className="grid gap-1 py-2.5 sm:grid-cols-[150px_1fr] sm:gap-4">
                <dt className="font-medium text-text">{label}</dt>
                <dd className="text-text-dim">{question.framework![key]}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      {question.tips.length > 0 ? (
        <section aria-label="Tips people overlook" className="mt-6">
          <h2 className="text-lead font-semibold text-text">Tips people overlook</h2>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-text-dim">
            {question.tips.map((tip) => <li key={tip}>{tip}</li>)}
          </ul>
        </section>
      ) : null}

      {builtOn.length > 0 ? (
        <section aria-label="Builds on" className="mt-6">
          <h2 className="text-lead font-semibold text-text">Builds on</h2>
          <ul className="mt-2 space-y-1">
            {builtOn.map((problem) => (
              <li key={problem.slug} className="flex flex-wrap items-baseline gap-x-2">
                {problem.published ? (
                  <Link href={`/problems/${problem.slug}` as `/problems/${string}`}
                        className="text-text underline-offset-2 hover:underline">
                    {problem.title}
                  </Link>
                ) : (
                  <span className="text-text">{problem.title}</span>
                )}
                {problem.track && isTrack(problem.track) ? (
                  <span className="text-meta text-text-faint">{TRACK_NAMES[problem.track]}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

/** The question's interviewers to choose between, as links, the chosen one
 *  marked as well as drawn. */
function InterviewerChoice({ slugs, chosen, names, query }: {
  slugs: string[];
  chosen: string;
  names: Map<string, string>;
  query: Record<string, string>;
}) {
  if (slugs.length < 2) return null;
  return (
    <nav aria-label="Choose your interviewer" className="mb-3 flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-meta text-text-faint">Asked by</span>
      {slugs.map((slug) => (
        <Link key={slug} href={{ pathname: "/voice/session", query: { ...query, interviewer: slug } }}
              aria-current={slug === chosen ? "true" : undefined}
              className={cn("inline-flex h-7 items-center rounded-full border px-2.5 text-meta",
                            slug === chosen ? "border-border-strong bg-surface-3 text-text"
                              : "border-border text-text-dim hover:bg-surface-2 hover:text-text")}>
          {names.get(slug) ?? slug}
        </Link>
      ))}
    </nav>
  );
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
  const wanted = requested === "pressure" && question.followUps.length === 0 ? "guided" : requested;

  // Who asks: the link's choice when it is published, else the question's
  // first. A choice the link made is also the filter Next question keeps, as
  // is the picker's track, so Next question stays with the same interviewer
  // inside the same list.
  const chosen = first(params.interviewer) ?? null;
  const askedTrack = first(params.track);
  const track = (VOICE_TRACK_ORDER as readonly string[]).find((candidate) => candidate === askedTrack) ?? null;
  const [everyone, builtOn] = await Promise.all([
    loadInterviewers(), problemsBuiltOn(question.buildsOn),
  ]);
  const interviewer = lobbyInterviewer(everyone, chosen, question.interviewers);
  const explicit = interviewer && interviewer.slug === chosen ? interviewer.slug : null;
  // Interview mode needs somebody to follow up, so a question that names no
  // interviewer runs it as guided. The room seats the panel's three members.
  const mode = wanted === "interview" && !interviewer ? "guided" : wanted;
  const [rounds, seated] = interviewer
    ? await Promise.all([interviewRoundsForQuestion(question.id),
                         interviewer.slug === PANEL ? membersOf(interviewer) : [interviewer]])
    : [0, []];
  const carry: Record<string, string> = {};
  if (explicit) carry.interviewer = explicit;
  if (track) carry.track = track;

  const [{ granted }, next, guided, unguided, pressure] = await Promise.all([
    consentState(learner.enrolmentId), nextQuestionSlug(question.slug, { track, interviewer: explicit }),
    allowanceFor({ enrolmentId: learner.enrolmentId, scope: voiceScope("guided") }),
    allowanceFor({ enrolmentId: learner.enrolmentId, scope: voiceScope("unguided") }),
    allowanceFor({ enrolmentId: learner.enrolmentId, scope: voiceScope("pressure") }),
  ]);
  const readiness = voiceReadiness();
  if (!readiness.ready) logVoiceNotSetUp(readiness.missing);
  const staff = learner.role !== "learner";
  // Pressure is an interviewer cutting in out loud, and interview mode a
  // conversation out loud, so a typed answer in either is a guided one.
  const typedMode = mode === "pressure" || mode === "interview" ? "guided" : mode;
  const practice = "Timed practice, nothing is recorded or scored";
  const names = new Map(everyone.map((person) => [person.slug, person.name]));
  const choices = interviewer && !question.interviewers.includes(interviewer.slug)
    ? [...question.interviewers.filter((slug) => names.has(slug)), interviewer.slug]
    : question.interviewers.filter((slug) => names.has(slug));

  const rows: Array<{ key: string; name: string; line: string; spends: string; current: boolean;
                      query: Record<string, string> }> = [
    { key: "guided", name: "Guided", line: "Five instruments while you speak.",
      spends: readiness.ready ? left(guided, "today") : practice,
      current: !typed && mode === "guided", query: { q: question.slug, mode: "guided", ...carry } },
    { key: "unguided", name: "Unguided",
      line: "The clock and a microphone; the instruments come back in the debrief.",
      spends: readiness.ready ? left(unguided, "today") : practice,
      current: !typed && mode === "unguided", query: { q: question.slug, mode: "unguided", ...carry } },
    ...(question.followUps.length > 0 ? [{
      key: "pressure", name: "Pressure", line: "Guided, and the interviewer cuts in twice.",
      spends: readiness.ready ? left(pressure, "this week, shared with rehearsals") : practice,
      current: !typed && mode === "pressure", query: { q: question.slug, mode: "pressure", ...carry },
    }] : []),
    ...(interviewer ? [{
      key: "interview", name: "Interview",
      line: `Guided, then ${interviewer.slug === PANEL ? "the panel follows" :
        `${interviewer.name.split(" ")[0]} follows`} up on what you said, up to ${rounds} rounds.`,
      spends: readiness.ready ? left(pressure, "this week, shared with rehearsals") : practice,
      current: !typed && mode === "interview", query: { q: question.slug, mode: "interview", ...carry },
    }] : []),
    { key: "typed", name: "Type",
      line: "Write the answer when you cannot speak; it is scored on the same rubric.",
      spends: `Spends the ${typedMode} allowance`,
      current: typed, query: { q: question.slug, mode: typedMode, input: "typed", ...carry } },
  ];

  // Above every state, and handed to the cockpit as its lobby, which it draws
  // only while no answer is running: docs/07 keeps the mode links off screen
  // mid-answer.
  const round = question.round && isRound(question.round) ? question.round : null;
  const start = (
    <div>
      <h1 className="text-display font-semibold tracking-[-0.02em] text-text">{question.title}</h1>
      <p className="tnum mt-1 text-text-dim">
        {clock(question.totalSeconds * 1000)} on the clock
        {round ? <> · {ROUND_NAMES[round]}. <span className="text-text-faint">{ROUND_LINES[round]}</span></> : null}
      </p>

      {interviewer ? (
        <div className="mt-6">
          <InterviewerChoice slugs={choices} chosen={interviewer.slug} names={names}
                             query={{ q: question.slug, mode: typed ? typedMode : mode, ...(typed ? { input: "typed" } : {}),
                                      ...(track ? { track } : {}) }} />
          {/* The room is content, drawn in the diagram tones, and appears
              only here, while no answer runs, and on the debrief. */}
          <div className="mb-3 overflow-hidden rounded-panel border border-border bg-surface">
            <InterviewRoom size="lobby"
                           interviewers={seated.map((person) => ({ slug: person.slug, name: person.name,
                                                                   role: person.title }))} />
          </div>
          <InterviewerCard interviewer={interviewer} questionId={question.id} speaks={ttsConfig() !== null} />
        </div>
      ) : null}

      <Teaching question={question} builtOn={builtOn} />

      <h2 className="mt-8 text-lead font-semibold text-text">How you will answer</h2>
      <ul className="mt-3 divide-y divide-border overflow-hidden rounded-panel border border-border bg-surface">
        {rows.map((row) => (
          <li key={row.key}>
            <Link href={{ pathname: "/voice/session", query: row.query }}
                  aria-current={row.current ? "page" : undefined}
                  className={cn("flex items-baseline justify-between gap-4 px-4 py-3 hover:bg-surface-2",
                                // The cockpit below spends this screen's accent on its own buttons.
                                row.current && "bg-surface-2 shadow-[inset_2px_0_0_var(--color-text)]")}>
              <span className="min-w-0">
                <span className="font-medium text-text">{row.name}.</span>{" "}
                <span className="text-text-dim">{row.line}</span>
              </span>
              <span className="tnum shrink-0 text-right text-meta text-text-faint">{row.spends}</span>
            </Link>
          </li>
        ))}
      </ul>
      {readiness.ready ? (
        <p className="mt-3 text-meta text-text-faint">
          An answer you stop inside its first thirty seconds, before forty words, does not count.
        </p>
      ) : null}
      {staff && !beatsAreAPathway(question.beats) ? (
        <p className="mt-4 rounded-control border border-warn/40 bg-warn-soft px-3 py-2 text-text">
          This question has {question.beats.length} beats. docs/07 asks for four to six.
        </p>
      ) : null}
    </div>
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
            {start}
            {mode === "pressure" ? (
              <p className="mt-6 text-text-dim">
                Pressure needs a spoken answer, because the interviewer interrupts out loud. This
                one is guided instead.
              </p>
            ) : mode === "interview" ? (
              <p className="mt-6 text-text-dim">
                Interview mode needs a spoken answer, because the interviewer follows up out loud.
                This one is guided instead.
              </p>
            ) : null}
            <TypedAnswer key={`${question.slug}:${typedMode}`} question={question} mode={typedMode}
                         wordLimit={typedWordLimit(question.totalSeconds)} />
          </>
        ) : !readiness.ready ? (
          <>
            {start}
            <h2 className="mt-10 text-lead font-semibold text-text">Answer it out loud against the clock</h2>
            <div className="mt-4 rounded-panel border border-border bg-surface p-5 sm:p-6">
              <VoicePractice key={question.slug} prompt={question.promptText} totalSeconds={question.totalSeconds}
                             beats={question.beats.map((b) => ({ key: b.key, label: b.label, seconds: b.seconds }))} />
            </div>
          </>
        ) : !granted ? (
          <>
            {start}
            <div className="mt-8 rounded-panel border border-border bg-surface p-6">
              <ShieldCheck aria-hidden className="size-6 text-text-dim" strokeWidth={1.75} />
              <h2 className="mt-3 text-title font-semibold text-text">Recording needs your consent first</h2>
              <p className="mt-2 text-text-dim">
                A graded session records your audio so the debrief can play it back. Read what is kept,
                for how long and who can hear it, then accept or leave.
              </p>
              <div className="mt-5 flex flex-wrap gap-2.5">
                <ButtonLink href="/voice/consent" variant="primary">Read what is recorded</ButtonLink>
                <ButtonLink href={{ pathname: "/voice/session",
                                    query: { q: question.slug, mode: typedMode, input: "typed", ...carry } }}
                            variant="ghost">
                  <Keyboard aria-hidden /> Type the answer instead
                </ButtonLink>
                <ButtonLink href="/voice" variant="ghost">Not now</ButtonLink>
              </div>
            </div>
          </>
        ) : (
          /* Keyed so a new question or mode is a new cockpit. Its refs hold
             the session, the transcript and the follow-ups already fired, and
             a cockpit reused across questions carried all three over. */
          <Cockpit key={`${question.slug}:${mode}:${interviewer?.slug ?? ""}`} question={question} mode={mode}
                   nextSlug={next !== question.slug ? next : null} lobby={start}
                   interviewer={interviewer ? { slug: interviewer.slug, name: interviewer.name } : null}
                   carry={carry} />
        )}
      </main>
    </div>
  );
}
