/** Past answers, newest first, each one a way into its debrief. */
import Link from "next/link";
import type { Metadata, Route } from "next";
import { Mic } from "lucide-react";
import {
  audioState, pastSessions, scoreState, type AudioState, type PastSession, type ScoreState,
} from "@/lib/voice/debrief";
import { RETENTION_DAYS } from "@/lib/voice/audio";
import { currentLearner } from "@/lib/session/current";
import { EmptyState } from "@/components/ui/empty-state";
import { ButtonLink } from "@/components/ui/button";
import { Page, PageHeading } from "@/components/ui/page";
import { Cell, Head, Row, Table } from "@/components/ui/table";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Past answers" };

const SCORE: Readonly<Record<Exclude<ScoreState, "scored">, string>> = {
  not_counted: "Not counted",
  scoring: "Scoring",
  late: "Scoring is late. Tell your faculty.",
  gave_up: "Not scored. Answer again; nothing was spent.",
};

const AUDIO: Readonly<Record<AudioState, string>> = {
  typed: "Typed",
  kept: "Kept",
  expired: `Deleted after ${RETENTION_DAYS} days`,
  deleted: "Deleted",
  none: "None",
};

function score(session: PastSession, now: Date): string {
  const state = scoreState(session, now);
  return state === "scored" ? String(Math.round(session.score!)) : SCORE[state];
}

export default async function PastSessionsPage() {
  const learner = await currentLearner();
  const sessions = await pastSessions(learner.enrolmentId);
  const now = new Date();

  return (
    <Page>
      {/* With no answers the empty state's button is the page's one action. */}
      <PageHeading title="Past answers" line="Every answer you finished, spoken or typed, with its debrief."
                   action={sessions.length ? (
                     <ButtonLink href="/voice" variant="primary"><Mic aria-hidden /> Answer a question</ButtonLink>
                   ) : undefined} />

      {sessions.length === 0 ? (
        <EmptyState icon={Mic}
                    action={<ButtonLink href="/voice" size="sm" variant="primary">Answer a question</ButtonLink>}>
          You have not finished an answer yet. Pick a question; each one runs two to three minutes.
        </EmptyState>
      ) : (
        /* The date and the recording state hold one line and the title takes what is left.
           Fixed widths, measured in Geist, put every title on two lines; this keeps most on one. */
        <Table head={
          <Head>
            <Cell head>Question</Cell>
            <Cell head>Mode</Cell>
            <Cell head>When</Cell>
            <Cell head>Score</Cell>
            <Cell head className="text-right">Audio</Cell>
          </Head>
        }>
          {sessions.map((session) => (
            <Row key={session.id} className="hover:bg-surface-2">
              <Cell>
                <Link href={`/voice/sessions/${session.id}` as Route} className="font-medium text-text hover:text-accent">
                  {session.title}
                </Link>
              </Cell>
              <Cell className="capitalize text-text-dim">{session.mode}</Cell>
              <Cell className="whitespace-nowrap text-text-dim">
                {new Date(session.startedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
              </Cell>
              {/* Left-aligned: a score shares this column with a sentence saying why there is none. */}
              <Cell className={session.score === null ? "text-text-dim" : "tnum text-text"}>
                {score(session, now)}
              </Cell>
              <Cell className="whitespace-nowrap text-right text-text-dim">{AUDIO[audioState(session)]}</Cell>
            </Row>
          ))}
        </Table>
      )}
    </Page>
  );
}
