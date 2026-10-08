/**
 * Screen S9, progress.
 *
 * It opens on the readiness line, the same object Home draws from the same
 * query (docs/12 section 2), then the heatmap behind it, drawn by the
 * component the admin learner page also uses, and the attempts behind that.
 */
import Link from "next/link";
import type { Metadata, Route } from "next";
import { Download, Grid2x2, History as HistoryIcon } from "lucide-react";
import { attemptHistory, heatmap } from "@/lib/progress";
import { coverageFor } from "@/lib/progress/coverage";
import { readinessFor } from "@/lib/progress/readiness";
import { currentLearner } from "@/lib/session/current";
import { relativeDay } from "@/lib/progress/summary";
import { CompetencyHeatmap, untouched } from "@/components/progress/heatmap";
import { ReadinessLine } from "@/components/progress/readiness-line";
import { DifficultyMeter } from "@/components/ui/difficulty";
import { EmptyState } from "@/components/ui/empty-state";
import { ButtonLink } from "@/components/ui/button";
import { Page, PageHeading, SectionHeading } from "@/components/ui/page";
import { StatusIcon } from "@/components/ui/status";
import { Cell as TableCell, Head, NumCell, Row, Table } from "@/components/ui/table";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Progress" };

export default async function ProgressPage() {
  const learner = await currentLearner();
  const [grid, history, readiness, coverage] = await Promise.all([
    heatmap(learner.enrolmentId),
    attemptHistory(learner.enrolmentId),
    readinessFor(learner.enrolmentId),
    coverageFor(learner.enrolmentId),
  ]);

  return (
    <Page>
      <PageHeading title="Progress" action={
        // A plain anchor: this is a download, not a route transition, and
        // Link would prefetch a CSV nobody asked for yet.
        <a href="/api/progress/export" download
           className="inline-flex h-8 items-center gap-1.5 rounded-control border border-border-strong
                      bg-surface-2 px-3 font-medium text-text hover:border-border-control hover:bg-surface-3">
          <Download aria-hidden className="size-4" /> Export CSV
        </a>
      } />

      <ReadinessLine readiness={readiness} coverage={coverage} heatmapLink={false} />

      <CompetencyHeatmap grid={grid}>
        {untouched(grid) ? (
          <EmptyState icon={Grid2x2} className="mt-4"
                      action={<ButtonLink href="/" size="sm" variant="primary">Open your path</ButtonLink>}>
            Every cell is empty. Pass a problem with no hints and inside its call budget, and its
            competencies fill in here.
          </EmptyState>
        ) : null}
      </CompetencyHeatmap>

      <section aria-labelledby="history">
        <SectionHeading id="history"
                        title={history.length
                          ? `Attempt history, ${history.length} ${history.length === 1 ? "problem" : "problems"}`
                          : "Attempt history"} />
        {history.length ? (
          <Table className="mt-4" head={
            <Head>
              <TableCell head>Problem</TableCell>
              <TableCell head>Result</TableCell>
              <TableCell head>Last activity</TableCell>
              <NumCell head>Submits</NumCell>
              <NumCell head>Hints</NumCell>
              <TableCell head>Best budget</TableCell>
              <NumCell head>Defence</NumCell>
            </Head>
          }>
            {history.map((row) => (
              <Row key={row.slug} className="hover:bg-surface-2">
                <TableCell>
                  <Link href={`/problems/${row.slug}` as Route} className="font-medium text-text hover:text-accent">
                    {row.title}
                  </Link>
                  <div className="mt-0.5 text-meta"><DifficultyMeter difficulty={row.difficulty} /></div>
                </TableCell>
                <TableCell>
                  {row.verdict !== null ? (
                    <span className="inline-flex items-center gap-1.5 text-text-dim">
                      <StatusIcon kind={row.verdict === "pass" ? "pass" : "fail"} />
                      {row.verdict === "pass" ? "Passed" : "Not yet"}
                    </span>
                  ) : row.lastAt ? (
                    // Submitted, and the verdict has not come back yet.
                    <span className="inline-flex items-center gap-1.5 text-text-dim">
                      <StatusIcon kind="queued" label="Waiting for a verdict" />
                      Waiting for a verdict
                    </span>
                  ) : (
                    <span className="text-text-faint">Open</span>
                  )}
                </TableCell>
                <TableCell className="text-text-dim">{row.lastAt ? relativeDay(row.lastAt) : "Not run"}</TableCell>
                <NumCell className="text-text-dim">{row.submits}</NumCell>
                <NumCell className="text-text-dim">{row.hintsUsed}</NumCell>
                <TableCell className="tnum text-text-dim">
                  {row.bestBudgetCalls === null ? "None yet"
                    : `${row.bestBudgetCalls}${row.callBudget ? ` of ${row.callBudget} calls` : " calls"}`}
                </TableCell>
                <NumCell className="text-text-dim">
                  {row.defenceScore === null ? "None" : Math.round(row.defenceScore)}
                </NumCell>
              </Row>
            ))}
          </Table>
        ) : (
          // No button: the heatmap's empty state above carries the one Open your path.
          <EmptyState icon={HistoryIcon} className="mt-4">
            Nothing attempted yet. Your first problem is waiting at the top of your path.
          </EmptyState>
        )}
      </section>
    </Page>
  );
}
