/**
 * Screen S9, progress.
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
import { Check, CircleDot, Download, History as HistoryIcon, Minus } from "lucide-react";
import { attemptHistory, heatmap, type HeatCell } from "@/lib/progress";
import { currentLearner } from "@/lib/session/current";
import { DIFFICULTIES, difficultyLabel } from "@/lib/policy/tiers";
import { relativeDay } from "@/lib/progress/summary";
import { DifficultyMeter } from "@/components/ui/difficulty";
import { EmptyState } from "@/components/ui/empty-state";
import { ButtonLink } from "@/components/ui/button";
import { StatusIcon } from "@/components/ui/status";
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
  const grid = await heatmap(learner.enrolmentId);
  const history = await attemptHistory(learner.enrolmentId);
  const touched = grid.rows.filter((row) => row.cells.some((c) => c.state !== "untouched")).length;

  return (
    <main className="mx-auto max-w-[1280px] px-4 pb-16 pt-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-display font-semibold tracking-[-0.02em] text-text">Progress</h1>
          <p className="mt-1 text-text-dim">
            Thirteen competencies at four tiers. Placement reads the clean cells and nothing else.
          </p>
        </div>
        {/* A plain anchor: this is a download, not a route transition, and
            Link would prefetch a CSV nobody asked for yet. */}
        <a href="/api/progress/export" download
           className="inline-flex h-8 items-center gap-1.5 rounded-control border border-border-strong
                      bg-surface-2 px-3 font-medium text-text hover:border-border-control hover:bg-surface-3">
          <Download aria-hidden className="size-4" /> Export CSV
        </a>
      </div>

      <dl className="mt-6 grid grid-cols-3 divide-x divide-border overflow-hidden rounded-panel border border-border bg-surface">
        <Stat label="Clean cells" value={`${grid.cleanCells} of ${grid.totalCells}`} />
        <Stat label="Competencies started" value={`${touched} of ${grid.rows.length}`} />
        <Stat label="Problems attempted" value={String(history.length)} />
      </dl>

      <section className="mt-10">
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
      </section>

      <section className="mt-12">
        <h2 className="text-title font-semibold tracking-[-0.01em] text-text">Attempt history</h2>
        {history.length ? (
          <div className="mt-4 overflow-x-auto rounded-panel border border-border">
            <table className="w-full min-w-[720px] border-collapse text-left">
              <thead className="bg-surface-2">
                <tr className="text-meta text-text-faint">
                  {["Problem", "Result", "Last activity", "Submits", "Hints", "Best budget", "Defence"].map((head) => (
                    <th key={head} scope="col" className="px-4 py-2.5 font-medium">{head}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-surface">
                {history.map((row) => (
                  <tr key={row.slug} className="hover:bg-surface-2">
                    <td className="px-4 py-2.5">
                      <Link href={`/problems/${row.slug}` as Route} className="font-medium text-text hover:text-accent">
                        {row.title}
                      </Link>
                      <div className="mt-0.5 text-meta"><DifficultyMeter difficulty={row.difficulty} /></div>
                    </td>
                    <td className="px-4 py-2.5">
                      {row.verdict === null ? (
                        <span className="text-text-faint">Open</span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-text-dim">
                          <StatusIcon kind={row.verdict === "pass" ? "pass" : "fail"} />
                          {row.verdict === "pass" ? "Passed" : "Not yet"}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-text-dim">{row.lastAt ? relativeDay(row.lastAt) : "Not run"}</td>
                    <td className="tnum px-4 py-2.5 text-text-dim">{row.submits}</td>
                    <td className="tnum px-4 py-2.5 text-text-dim">{row.hintsUsed}</td>
                    <td className="tnum px-4 py-2.5 text-text-dim">
                      {row.bestBudgetCalls === null ? "None yet"
                        : `${row.bestBudgetCalls}${row.callBudget ? ` of ${row.callBudget} calls` : " calls"}`}
                    </td>
                    <td className="tnum px-4 py-2.5 text-text-dim">
                      {row.defenceScore === null ? "None" : Math.round(row.defenceScore)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={HistoryIcon} className="mt-4"
                      action={<ButtonLink href="/" size="sm" variant="primary">Open your path</ButtonLink>}>
            Nothing attempted yet. Your first problem is waiting at the top of your path.
          </EmptyState>
        )}
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-5 py-4">
      <dt className="text-meta text-text-faint">{label}</dt>
      <dd className="tnum mt-1 text-title font-semibold tracking-[-0.01em] text-text">{value}</dd>
    </div>
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
