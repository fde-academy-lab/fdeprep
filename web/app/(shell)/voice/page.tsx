/**
 * The Voice page: every published question in one table, and one way into
 * each. The mode is picked on the session's own start screen, where the
 * allowance of each mode sits beside it.
 *
 * Ordered by track in docs/07 section 11's order and then by slug, which is
 * also the order Next question walks. The track is written on the first row
 * of its group, so the eye reads five groups in one table.
 *
 * Two filters above the table, by interviewer and by competency, added 9
 * October 2026 for S13.4. Each is a link with a query string the server
 * checks against what is published, and the question links carry the same
 * filters into the lobby so Next question stays inside the list the learner
 * chose from.
 */
import Link from "next/link";
import type { Metadata } from "next";
import { Mic } from "lucide-react";
import { allowanceFor, voiceScope } from "@/lib/policy/caps";
import { currentLearner } from "@/lib/session/current";
import { logOnce } from "@/lib/log-once";
import { clock } from "@/lib/voice/clock";
import { loadInterviewers } from "@/lib/voice/interviewers";
import { publishedQuestions } from "@/lib/voice/question";
import { roundName } from "@/lib/voice/rounds";
import { logVoiceNotSetUp, voiceReadiness } from "@/lib/voice/start";
import { ButtonLink } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { DifficultyMeter } from "@/components/ui/difficulty";
import { EmptyState } from "@/components/ui/empty-state";
import { Page, PageHeading } from "@/components/ui/page";
import { Cell, Head, Row, Table } from "@/components/ui/table";
import { trackName } from "@/components/ui/tracks";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Voice" };

type Params = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function heading(track: string): string {
  const name = trackName(track);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** One filter value per link. The current one is marked for a screen reader
 *  as well as drawn, so the state is never colour alone. */
function Filter({ href, current, children }: {
  href: { pathname: "/voice"; query: Record<string, string> };
  current: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} aria-current={current ? "true" : undefined}
          className={cn("inline-flex h-7 items-center rounded-full border px-2.5 text-meta",
                        current ? "border-border-strong bg-surface-3 text-text"
                          : "border-border text-text-dim hover:bg-surface-2 hover:text-text")}>
      {children}
    </Link>
  );
}

export default async function VoicePage({ searchParams }: { searchParams?: Promise<Params> } = {}) {
  const params = (await searchParams) ?? {};
  const learner = await currentLearner();
  const [all, interviewers, pressure] = await Promise.all([
    publishedQuestions(),
    loadInterviewers(),
    allowanceFor({ enrolmentId: learner.enrolmentId, scope: voiceScope("pressure") }),
  ]);
  // The filters are values the server knows about, or nothing.
  const tracks = [...new Set(all.map((question) => question.track))];
  const asked = first(params.interviewer);
  const by = interviewers.find((interviewer) => interviewer.slug === asked)?.slug ?? null;
  const askedTrack = first(params.track);
  const track = tracks.find((candidate) => candidate === askedTrack) ?? null;
  const questions = by || track ? await publishedQuestions({ track, interviewer: by }) : all;

  const readiness = voiceReadiness();
  if (!readiness.ready) logVoiceNotSetUp(readiness.missing);
  if (!all.length) {
    logOnce("No voice question is published: run npm run import:content in web/ to load voice-questions/.");
  }

  /** The picker's address with one filter changed and the other kept. */
  const filtered = (change: { interviewer?: string | null; track?: string | null }) => {
    const next = { interviewer: by, track, ...change };
    const query: Record<string, string> = {};
    if (next.interviewer) query.interviewer = next.interviewer;
    if (next.track) query.track = next.track;
    return { pathname: "/voice" as const, query };
  };
  const carried: Record<string, string> = {};
  if (by) carried.interviewer = by;
  if (track) carried.track = track;

  return (
    <Page>
      <div>
        <PageHeading title="Voice" action={
          <span className="flex gap-4">
            <Link href="/voice/interviewers" className="text-text-dim hover:text-text">Meet the interviewers</Link>
            <Link href="/voice/sessions" className="text-text-dim hover:text-text">Past answers</Link>
          </span>
        } />
        {/* The scarce allowance is the one worth reading before choosing.
            With spoken answers off nothing spends it, so the line says that instead. */}
        {!readiness.ready ? (
          <p className="mt-2 max-w-[70ch] text-text-dim">
            Spoken answers are not switched on for this cohort yet, so a spoken run is timed practice
            and only a typed answer is scored.
          </p>
        ) : pressure.max !== null ? (
          <p className="tnum mt-2 text-text-dim">
            Pressure answers left this week: {pressure.remaining} of {pressure.max}, shared with rehearsals.
          </p>
        ) : null}
      </div>

      {all.length === 0 ? (
        <EmptyState icon={Mic}>
          No interview questions are published yet. Ask your faculty to run the content import.
        </EmptyState>
      ) : (
        <div className="space-y-4">
          <nav aria-label="Filter the questions" className="space-y-2">
            {interviewers.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-meta text-text-faint">Interviewer</span>
                <Filter href={filtered({ interviewer: null })} current={by === null}>Anyone</Filter>
                {interviewers.map((interviewer) => (
                  <Filter key={interviewer.slug} href={filtered({ interviewer: interviewer.slug })}
                          current={by === interviewer.slug}>
                    {interviewer.name}
                  </Filter>
                ))}
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-meta text-text-faint">Competency</span>
              <Filter href={filtered({ track: null })} current={track === null}>All</Filter>
              {tracks.map((candidate) => (
                <Filter key={candidate} href={filtered({ track: candidate })} current={track === candidate}>
                  {heading(candidate)}
                </Filter>
              ))}
            </div>
          </nav>

          {questions.length === 0 ? (
            <EmptyState icon={Mic}
                        action={<ButtonLink href="/voice" size="sm">Show every question</ButtonLink>}>
              No question matches both filters. Clear one of them to see more.
            </EmptyState>
          ) : (
            <Table widths={[150, null, 150, 100, 64, 96]} head={
              <Head>
                <Cell head>Competency</Cell>
                <Cell head>Question</Cell>
                <Cell head>Round</Cell>
                <Cell head>Difficulty</Cell>
                <Cell head className="text-right">Clock</Cell>
                <Cell head className="text-right">Answer</Cell>
              </Head>
            }>
              {questions.map((question, index) => (
                <Row key={question.slug}>
                  <Cell className="text-text-dim">
                    {index === 0 || questions[index - 1]!.track !== question.track ? heading(question.track) : null}
                  </Cell>
                  <Cell className="font-medium text-text">{question.title}</Cell>
                  <Cell className="text-text-dim">{roundName(question.round)}</Cell>
                  <Cell><DifficultyMeter difficulty={question.difficulty} /></Cell>
                  <Cell className="tnum text-right font-mono text-text-dim">{clock(question.totalSeconds * 1000)}</Cell>
                  <Cell className="text-right">
                    <ButtonLink size="sm" href={{ pathname: "/voice/session", query: { q: question.slug, ...carried } }}
                                aria-label={`Answer ${question.title}`}>
                      Answer
                    </ButtonLink>
                  </Cell>
                </Row>
              ))}
            </Table>
          )}
        </div>
      )}
    </Page>
  );
}
