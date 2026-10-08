/**
 * The Voice page: every published question in one table, and one way into
 * each. The mode is picked on the session's own start screen, where the
 * allowance of each mode sits beside it.
 *
 * Ordered by track in docs/07 section 11's order and then by slug, which is
 * also the order Next question walks. The track is written on the first row
 * of its group, so the eye reads five groups in one table.
 */
import Link from "next/link";
import type { Metadata } from "next";
import { Mic } from "lucide-react";
import { allowanceFor, voiceScope } from "@/lib/policy/caps";
import { currentLearner } from "@/lib/session/current";
import { logOnce } from "@/lib/log-once";
import { clock } from "@/lib/voice/clock";
import { consentState } from "@/lib/voice/consent";
import { publishedQuestions } from "@/lib/voice/question";
import { logVoiceNotSetUp, voiceReadiness } from "@/lib/voice/start";
import { ButtonLink } from "@/components/ui/button";
import { DifficultyMeter } from "@/components/ui/difficulty";
import { EmptyState } from "@/components/ui/empty-state";
import { Page, PageHeading } from "@/components/ui/page";
import { Cell, Head, Row, Table } from "@/components/ui/table";
import { trackName } from "@/components/ui/tracks";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Voice" };

function heading(track: string): string {
  const name = trackName(track);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export default async function VoicePage() {
  const learner = await currentLearner();
  const [questions, consent, pressure] = await Promise.all([
    publishedQuestions(),
    consentState(learner.enrolmentId),
    allowanceFor({ enrolmentId: learner.enrolmentId, scope: voiceScope("pressure") }),
  ]);
  const readiness = voiceReadiness();
  if (!readiness.ready) logVoiceNotSetUp(readiness.missing);
  if (!questions.length) {
    logOnce("No voice question is published: run npm run import:content in web/ to load voice-questions/.");
  }

  return (
    <Page>
      <div>
        <PageHeading title="Voice"
                     action={<Link href="/voice/sessions" className="text-text-dim hover:text-text">Past answers</Link>} />
        {/* The scarce allowance is the one worth reading before choosing.
            With spoken answers off nothing spends it, so the line says that instead. */}
        {!readiness.ready ? (
          <p className="mt-2 max-w-[70ch] text-text-dim">
            Spoken answers are not switched on for this cohort yet, so a spoken run is timed practice
            that records nothing. A typed answer is scored now.
          </p>
        ) : (
          <>
            {pressure.max !== null ? (
              <p className="tnum mt-2 text-text-dim">
                Pressure answers left this week: {pressure.remaining} of {pressure.max}, shared with rehearsals.
              </p>
            ) : null}
            {!consent.granted ? (
              <p className="mt-1 text-text-dim">
                A spoken answer is recorded, so it needs your consent once. A typed answer does not.{" "}
                <Link href="/voice/consent" className="text-text underline underline-offset-2">Read what is recorded</Link>
              </p>
            ) : null}
          </>
        )}
      </div>

      {questions.length === 0 ? (
        <EmptyState icon={Mic}>
          No interview questions are published yet. Ask your faculty to run the content import.
        </EmptyState>
      ) : (
        <Table widths={[170, null, 100, 64, 96]} head={
          <Head>
            <Cell head>Competency</Cell>
            <Cell head>Question</Cell>
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
              <Cell><DifficultyMeter difficulty={question.difficulty} /></Cell>
              <Cell className="tnum text-right font-mono text-text-dim">{clock(question.totalSeconds * 1000)}</Cell>
              <Cell className="text-right">
                <ButtonLink size="sm" href={{ pathname: "/voice/session", query: { q: question.slug } }}
                            aria-label={`Answer ${question.title}`}>
                  Answer
                </ButtonLink>
              </Cell>
            </Row>
          ))}
        </Table>
      )}
    </Page>
  );
}
