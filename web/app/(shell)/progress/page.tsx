/**
 * Screen S9, progress.
 *
 * It opens on the readiness line, the same object Home draws from the same
 * query (docs/12 section 2), then the heatmap behind it and the attempts
 * behind that.
 *
 * The heatmap is the readiness signal, so the fourth state is drawn
 * differently from the other three: docs/02 section 7 counts clean only, and a
 * grid where passed and clean look alike hides the distinction the whole
 * scoring model exists to make. Every cell carries a glyph as well as a
 * colour, so the grid reads the same to someone who cannot tell the colours
 * apart.
 */
import Link from "next/link";
import type { Metadata, Route } from "next";
import { Check, CircleDot, Download, Grid2x2, History as HistoryIcon, Minus } from "lucide-react";
import { attemptHistory, heatmap, type HeatCell } from "@/lib/progress";
import { readinessFor } from "@/lib/progress/readiness";
import { currentLearner } from "@/lib/session/current";
import { DIFFICULTIES, difficultyLabel } from "@/lib/policy/tiers";
import { relativeDay } from "@/lib/progress/summary";
import { ReadinessLine } from "@/components/progress/readiness-line";
import { DifficultyMeter } from "@/components/ui/difficulty";
import { EmptyState } from "@/components/ui/empty-state";
import { ButtonLink } from "@/components/ui/button";
import { Page, PageHeading, SectionHeading } from "@/components/ui/page";
import { StatusIcon } from "@/components/ui/status";
// The heatmap keeps its own Cell, so the table's is imported by another name.
import { Cell as TableCell, Head, NumCell, Row, Table } from "@/components/ui/table";
import { cn } from "@/components/ui/cn";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Progress" };

const CELL: Record<string, { label: string; box: string; icon: React.ReactNode }> = {
  untouched: {
    label: "Not attempted",
    box: "border-dashed border-border-strong bg-transparent text-text-faint",
    icon: null,
  },
  attempted: {
    label: "Attempted, no pass",
    box: "border-warn/40 bg-warn-soft text-warn",
    icon: <CircleDot aria-hidden className="size-3.5" />,
  },
  passed: {
    label: "Passed",
    box: "border-info/40 bg-accent-soft text-info",
    icon: <Minus aria-hidden className="size-3.5" strokeWidth={3} />,
  },
  clean: {
    label: "Passed clean",
    box: "border-pass/50 bg-pass-soft text-pass",
    icon: <Check aria-hidden className="size-3.5" strokeWidth={3} />,
  },
};

export default async function ProgressPage() {
  const learner = await currentLearner();
  const [grid, history, readiness] = await Promise.all([
    heatmap(learner.enrolmentId),
    attemptHistory(learner.enrolmentId),
    readinessFor(learner.enrolmentId),
  ]);
  const untouched = grid.rows.every((row) => row.cells.every((cell) => cell.state === "untouched"));

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

      <ReadinessLine readiness={readiness} heatmapLink={false} />

      <section>
        <h2 className="text-title font-semibold tracking-[-0.01em] text-text">Competency heatmap</h2>
        <div className="mt-4 overflow-x-auto rounded-panel border border-border bg-surface">
          <table className="w-full min-w-[560px] border-collapse text-left">
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="px-4 py-3 text-meta font-medium text-text-faint">Competency</th>
                {DIFFICULTIES.map((difficulty) => (
                  <th key={difficulty} scope="col" className="px-2 py-3 text-center text-meta font-medium text-text-faint">
                    <span className="inline-flex items-center gap-1.5">
                      <DifficultyMeter difficulty={difficulty} label={false} />
                      {difficultyLabel(difficulty)}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.rows.map((row) => (
                <tr key={row.slug} className="border-b border-border last:border-b-0">
                  <th scope="row" className="px-4 py-2 font-normal text-text">{sentence(row.name)}</th>
                  {row.cells.map((cell) => <Cell key={cell.difficulty} cell={cell} />)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-meta text-text-dim">
          {Object.entries(CELL).map(([state, look]) => (
            <li key={state} className="flex items-center gap-2">
              <span aria-hidden className={cn("grid size-5 place-items-center rounded-[5px] border", look.box)}>
                {look.icon}
              </span>
              {look.label}
            </li>
          ))}
        </ul>
        {untouched ? (
          <EmptyState icon={Grid2x2} className="mt-4"
                      action={<ButtonLink href="/" size="sm" variant="primary">Open your path</ButtonLink>}>
            Every cell is empty. Pass a problem with no hints and inside its call budget, and its
            competencies fill in here.
          </EmptyState>
        ) : null}
      </section>

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

function Cell({ cell }: { cell: HeatCell }) {
  const look = CELL[cell.state]!;
  return (
    <td className="px-2 py-2 text-center">
      <span title={`${difficultyLabel(cell.difficulty)}: ${look.label}`}
            className={cn("mx-auto grid h-7 w-full max-w-24 place-items-center rounded-control border",
                          look.box)}>
        {look.icon}
        <span className="sr-only">{difficultyLabel(cell.difficulty)}: {look.label}</span>
      </span>
    </td>
  );
}

/** "state and memory" reads as a label; "State And Memory" reads as a heading shouting. */
function sentence(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}
