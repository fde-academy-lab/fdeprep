/**
 * One learner, as faculty see them from a row of the Overview: their position,
 * the readiness line and the heatmap Progress shows them, the attempts with a
 * trace for each, their past answers with scores, and the report cards issued
 * for them. docs/00 section 8's per-learner drill-down.
 *
 * Read-only for faculty and admins alike, with one action: issuing a report
 * card (docs/11 section 3), which lives here because a card is a dated copy
 * of this page. Every other action stays on the screen that owns it.
 *
 * Learners never reach this route, because the admin layout refuses them.
 */
import Link from "next/link";
import type { Metadata, Route } from "next";
import { notFound } from "next/navigation";
import { FileBadge, History as HistoryIcon, Grid2x2, Mic } from "lucide-react";
import { permits } from "@/lib/admin/guard";
import { latestTraces, learnerFacts } from "@/lib/admin/overview";
import { issuedOn, reportCardsFor } from "@/lib/analytics/report-card";
import { attemptHistory, heatmap } from "@/lib/progress";
import { coverageFor } from "@/lib/progress/coverage";
import { readinessFor } from "@/lib/progress/readiness";
import { relativeDay } from "@/lib/progress/summary";
import { currentLearner } from "@/lib/session/current";
import { pastSessions, scoreState, type PastSession, type ScoreState } from "@/lib/voice/debrief";
import { CompetencyHeatmap, untouched } from "@/components/progress/heatmap";
import { ReadinessLine } from "@/components/progress/readiness-line";
import { DifficultyMeter } from "@/components/ui/difficulty";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeading, SectionHeading } from "@/components/ui/page";
import { StatStrip } from "@/components/ui/stat-strip";
import { StatusIcon } from "@/components/ui/status";
import { Cell, Head, NumCell, Row, Table } from "@/components/ui/table";
import { IssueReportCard } from "./issue-report-card";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

/** The learner in the viewer's cohort, or null for an id that is not one. */
async function find(props: Props) {
  const viewer = await currentLearner();
  const id = Number((await props.params).id);
  if (!permits(viewer.role, "faculty") || !Number.isInteger(id)) return null;
  return learnerFacts(id, viewer.cohortId);
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  return { title: (await find(props))?.displayName ?? "Learner" };
}

/**
 * Score words for staff. The learner's own Past answers says "Tell your
 * faculty"; here the reader is the faculty, so a missing score is named the
 * way Ops names it.
 */
const SCORE: Readonly<Record<Exclude<ScoreState, "scored">, string>> = {
  not_counted: "Not counted",
  scoring: "Scoring",
  late: "Scorer not running",
  gave_up: "Judge gave up",
};

function score(session: PastSession, now: Date): string {
  const state = scoreState(session, now);
  return state === "scored" ? String(Math.round(session.score!)) : SCORE[state];
}

export default async function LearnerPage(props: Props) {
  const learner = await find(props);
  if (!learner) notFound();
  const id = learner.enrolmentId;

  const [readiness, coverage, grid, history, traces, answers, cards] = await Promise.all([
    readinessFor(id), coverageFor(id), heatmap(id), attemptHistory(id), latestTraces(id),
    pastSessions(id), reportCardsFor(id),
  ]);
  const now = new Date();

  return (
    <>
      <PageHeading title={learner.displayName} />
      <StatStrip cells={[
        { label: "Login", value: learner.login },
        { label: "Persona", value: learner.persona.charAt(0).toUpperCase() + learner.persona.slice(1) },
        { label: "Cohort", value: learner.cohortName },
        ...(learner.state === "active" ? []
          : [{ label: "State", value: learner.state.charAt(0).toUpperCase() + learner.state.slice(1) }]),
      ]} />

      <ReadinessLine readiness={readiness} coverage={coverage} heatmapLink={false} />

      <CompetencyHeatmap grid={grid}>
        {untouched(grid) ? (
          <EmptyState icon={Grid2x2} className="mt-4">
            Every cell is empty. A cell fills in when this learner passes a problem with no hints
            and inside its call budget.
          </EmptyState>
        ) : null}
      </CompetencyHeatmap>

      <section aria-labelledby="history">
        <SectionHeading id="history" title="Attempt history" />
        {history.length ? (
          <Table className="mt-4" head={
            <Head>
              <Cell head>Problem</Cell>
              <Cell head>Result</Cell>
              <Cell head>Last activity</Cell>
              <NumCell head>Submits</NumCell>
              <NumCell head>Hints</NumCell>
              <Cell head>Best budget</Cell>
              <NumCell head>Defence</NumCell>
              <Cell head>Trace</Cell>
            </Head>
          }>
            {history.map((row) => {
              const trace = traces.get(row.problemId);
              return (
                <Row key={row.slug}>
                  <Cell>
                    <span className="font-medium text-text">{row.title}</span>
                    <div className="mt-0.5 text-meta"><DifficultyMeter difficulty={row.difficulty} /></div>
                  </Cell>
                  <Cell>
                    {row.verdict !== null ? (
                      <span className="inline-flex items-center gap-1.5 text-text-dim">
                        <StatusIcon kind={row.verdict === "pass" ? "pass" : "fail"} />
                        {row.verdict === "pass" ? "Passed" : "Not yet"}
                      </span>
                    ) : row.lastAt ? (
                      <span className="inline-flex items-center gap-1.5 text-text-dim">
                        <StatusIcon kind="queued" label="Waiting for a verdict" />
                        Waiting for a verdict
                      </span>
                    ) : (
                      <span className="text-text-faint">Open</span>
                    )}
                  </Cell>
                  <Cell className="text-text-dim">{row.lastAt ? relativeDay(row.lastAt) : "Not run"}</Cell>
                  <NumCell className="text-text-dim">{row.submits}</NumCell>
                  <NumCell className="text-text-dim">{row.hintsUsed}</NumCell>
                  <Cell className="tnum text-text-dim">
                    {row.bestBudgetCalls === null ? "None yet"
                      : `${row.bestBudgetCalls}${row.callBudget ? ` of ${row.callBudget} calls` : " calls"}`}
                  </Cell>
                  <NumCell className="text-text-dim">
                    {row.defenceScore === null ? "None" : Math.round(row.defenceScore)}
                  </NumCell>
                  <Cell>
                    {trace ? (
                      <Link href={`/traces/${trace}` as Route} className="text-text-dim underline-offset-2 hover:text-text hover:underline">
                        Trace
                      </Link>
                    ) : null}
                  </Cell>
                </Row>
              );
            })}
          </Table>
        ) : (
          <EmptyState icon={HistoryIcon} className="mt-4">
            Nothing attempted yet. Their first Run or Submit appears here with its trace.
          </EmptyState>
        )}
      </section>

      <section aria-labelledby="answers">
        <SectionHeading id="answers" title="Past answers" />
        {answers.length ? (
          <Table className="mt-4" head={
            <Head>
              <Cell head>Question</Cell>
              <Cell head>Mode</Cell>
              <Cell head>When</Cell>
              <Cell head>Score</Cell>
            </Head>
          }>
            {answers.map((session) => (
              <Row key={session.id}>
                <Cell className="font-medium text-text">{session.title}</Cell>
                <Cell className="capitalize text-text-dim">{session.mode}</Cell>
                <Cell className="whitespace-nowrap text-text-dim">
                  {new Date(session.startedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                </Cell>
                <Cell className={session.score === null ? "text-text-dim" : "tnum text-text"}>
                  {score(session, now)}
                </Cell>
              </Row>
            ))}
          </Table>
        ) : (
          <EmptyState icon={Mic} className="mt-4">
            No answers finished yet. A finished voice answer appears here with its score.
          </EmptyState>
        )}
      </section>

      <section aria-labelledby="report-cards">
        <SectionHeading id="report-cards" title="Report cards"
                        action={cards.length ? <IssueReportCard enrolmentId={id} /> : undefined} />
        {cards.length ? (
          <Table className="mt-4" head={
            <Head>
              <Cell head>Generated</Cell>
              <NumCell head>Readiness</NumCell>
              <NumCell head>Evaluations</NumCell>
              <Cell head>SHA-256</Cell>
              <Cell head>Issued by</Cell>
              <Cell head><span className="sr-only">Download</span></Cell>
            </Head>
          }>
            {cards.map((card) => (
              <Row key={card.id}>
                <Cell className="whitespace-nowrap text-text">{issuedOn(card.generatedAt)}</Cell>
                <NumCell className="text-text-dim">{card.readiness.percent}%</NumCell>
                <NumCell className="text-text-dim">{card.evaluations}</NumCell>
                <Cell className="font-mono text-meta text-text-dim" title={card.sha256}>
                  {card.sha256.slice(0, 12)}
                </Cell>
                <Cell className="text-text-dim">{card.issuedBy ?? "a script"}</Cell>
                <Cell className="text-right">
                  {/* A plain anchor: a download, which Link would prefetch. */}
                  <a href={`/api/admin/report-cards/${card.id}`} download
                     className="text-text-dim underline-offset-2 hover:text-text hover:underline">
                    Markdown
                  </a>
                </Cell>
              </Row>
            ))}
          </Table>
        ) : (
          <EmptyState icon={FileBadge} className="mt-4"
                      action={<IssueReportCard enrolmentId={id} variant="primary" />}>
            No report card issued yet. Issue one to give placement a dated copy of this page.
          </EmptyState>
        )}
      </section>
    </>
  );
}
