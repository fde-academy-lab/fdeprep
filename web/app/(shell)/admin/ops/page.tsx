/**
 * S10 Ops: queue depth, runner error rate for the last hour, live-run token
 * spend today, cap overrides.
 *
 * Laid out in the order the docs/05 runbook reads: the numbers that decide
 * whether anything is wrong, then the submissions waiting with no verdict that
 * the runbook's first procedure acts on, the voice answers waiting for a score,
 * the last seven days, and the two switches. Admin only.
 *
 * "Waiting" is this screen's word for a row the queue has not finished. "Stuck"
 * means a learner and problem pair with three failed submits and no pass, on
 * the Overview and the Cohort screen, and never this (docs/11 section 4).
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CircleCheck, Mic, TriangleAlert } from "lucide-react";
import { COUNTER_SCOPES } from "@/lib/admin";
import { permits } from "@/lib/admin/guard";
import {
  opsSnapshot, QUEUE_DEPTH_ALARM, sevenDays, STUCK_AFTER_MINUTES, waitingLabel,
} from "@/lib/admin/ops";
import { currentLearner } from "@/lib/session/current";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeading, SectionHeading } from "@/components/ui/page";
import { StatStrip } from "@/components/ui/stat-strip";
import { Cell, Head, NumCell, Row, Table } from "@/components/ui/table";
import { Requeue, Switches } from "./controls";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ops" };

const WHY = { scorer_not_running: "scorer not running", judge_gave_up: "judge gave up" } as const;

/** "8 Oct 14:02": written here, so the browser cannot render it in another time zone. */
function since(iso: string): string {
  const at = new Date(iso);
  const day = at.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const time = at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${day} ${time}`;
}

/** "Thu 8 Oct", from a YYYY-MM-DD the database wrote, read as that calendar day. */
function day(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB",
    { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

export default async function OpsPage() {
  const learner = await currentLearner();
  if (!permits(learner.role, "admin")) notFound();
  const [snapshot, days] = await Promise.all([opsSnapshot(), sevenDays()]);

  return (
    <>
      <PageHeading title="Ops" />

      {snapshot.degraded.on ? (
        <p role="status" className="flex items-center gap-2 rounded-control border border-warn/40 bg-warn-soft
                                    px-3 py-2 text-text">
          <TriangleAlert aria-hidden className="size-4 shrink-0 text-warn" />
          Degraded mode is on. Submit is closed for every learner. {snapshot.degraded.reason}
        </p>
      ) : null}

      <StatStrip cells={[
        {
          label: "Submissions queued",
          value: <span className={snapshot.queueBackingUp ? "text-warn" : undefined}>{snapshot.queueDepth}</span>,
          note: snapshot.queueBackingUp
            ? `over ${QUEUE_DEPTH_ALARM}, the queue is draining` : "draining normally",
        },
        { label: "Judgements queued", value: snapshot.judgeDepth },
        {
          label: "Runner errors, last hour",
          value: <span className={snapshot.errorRate > 0.05 ? "text-warn" : undefined}>
            {Math.round(snapshot.errorRate * 100)}%
          </span>,
          note: `${snapshot.errorCount} of ${snapshot.eventCount} events`,
        },
        { label: "Live model calls today", value: snapshot.liveCallsToday },
        {
          // S14.5: the gap a learner waits between interview rounds.
          label: "Interview rounds today",
          value: snapshot.interviewToday.rounds,
          note: snapshot.interviewToday.p95GapMs === null ? "none asked yet"
            : `p95 gap ${(snapshot.interviewToday.p95GapMs / 1000).toFixed(1)} s, fallback ` +
              `${Math.round(snapshot.interviewToday.fallbackShare * 100)}%`,
        },
      ]} />

      <section aria-labelledby="waiting">
        <SectionHeading id="waiting"
                        title={`Waiting submissions, over ${STUCK_AFTER_MINUTES} minutes with no verdict`} />
        {snapshot.stuck.length ? (
          <Table className="mt-4" widths={[140, 240, null, 140, 120]} head={
            <Head>
              <Cell head>Submission</Cell>
              <Cell head>Learner</Cell>
              <Cell head>Problem</Cell>
              <NumCell head>Waiting</NumCell>
              <Cell head><span className="sr-only">Action</span></Cell>
            </Head>
          }>
            {snapshot.stuck.map((row) => (
              <Row key={row.id}>
                <Cell className="tnum">#{row.id}</Cell>
                <Cell>{row.login}</Cell>
                <Cell className="truncate text-text-dim">{row.slug}</Cell>
                <NumCell className="text-warn">{waitingLabel(row.waitingMinutes)}</NumCell>
                <Cell className="py-0.5! text-right"><Requeue submissionId={row.id} /></Cell>
              </Row>
            ))}
          </Table>
        ) : (
          <EmptyState icon={CircleCheck} className="mt-4"
                      action={<ButtonLink href="/admin/submissions" size="sm">Open Submissions</ButtonLink>}>
            Nothing is waiting. If a learner reports a wait, find their submission under Submissions.
          </EmptyState>
        )}
      </section>

      <section aria-labelledby="waiting-voice">
        <SectionHeading id="waiting-voice" title="Waiting voice answers, finished over an hour ago with no score" />
        <p className="mt-1 text-text-dim">
          The scorer is <code className="font-mono text-meta text-text">npm run scorevoice</code> on the
          worker host. A row that says the judge gave up has had its allowance returned.
        </p>
        {snapshot.stuckVoice.length ? (
          <Table className="mt-4" widths={[140, 240, null, 140, 180]} head={
            <Head>
              <Cell head>Session</Cell>
              <Cell head>Learner</Cell>
              <Cell head>Question</Cell>
              <NumCell head>Finished</NumCell>
              <Cell head>Why</Cell>
            </Head>
          }>
            {snapshot.stuckVoice.map((row) => (
              <Row key={row.id}>
                <Cell className="tnum">#{row.id}</Cell>
                <Cell>{row.login}</Cell>
                <Cell className="truncate text-text-dim">{row.questionTitle}</Cell>
                <NumCell className="text-text-dim">{waitingLabel(row.waitingMinutes)} ago</NumCell>
                <Cell className="text-warn">{WHY[row.why]}</Cell>
              </Row>
            ))}
          </Table>
        ) : (
          <EmptyState icon={Mic} className="mt-4">
            No voice answer is waiting. One appears here after an hour without a score.
          </EmptyState>
        )}
      </section>

      <section aria-labelledby="days">
        <SectionHeading id="days" title="Last seven days" />
        <Table className="mt-4" head={
          <Head>
            <Cell head>Date</Cell>
            <NumCell head>Runs</NumCell>
            <NumCell head>Submits</NumCell>
            <NumCell head>Passed</NumCell>
            <NumCell head>Failed</NumCell>
            <NumCell head>Errors</NumCell>
            <NumCell head>Voice answers</NumCell>
          </Head>
        }>
          {days.map((row) => (
            <Row key={row.date}>
              <Cell className="whitespace-nowrap">{day(row.date)}</Cell>
              <NumCell className="text-text-dim">{row.runs}</NumCell>
              <NumCell className="text-text-dim">{row.submits}</NumCell>
              <NumCell className="text-text-dim">{row.passed}</NumCell>
              <NumCell className="text-text-dim">{row.failed}</NumCell>
              <NumCell className={row.errors ? "text-warn" : "text-text-dim"}>{row.errors}</NumCell>
              <NumCell className="text-text-dim">{row.voiceAnswers}</NumCell>
            </Row>
          ))}
        </Table>
      </section>

      <Switches degraded={{ on: snapshot.degraded.on }}
                since={snapshot.degraded.since ? since(snapshot.degraded.since) : null}
                scopes={COUNTER_SCOPES} />
    </>
  );
}
