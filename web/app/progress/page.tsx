/**
 * Screen S9, progress.
 *
 * The heatmap is the readiness signal, so the fourth state is drawn
 * differently from the other three: docs/02 section 7 counts clean only, and a
 * grid where passed and clean look alike hides the distinction the whole
 * scoring model exists to make.
 */
import Link from "next/link";
import Nav from "../nav";
import { attemptHistory, heatmap, type HeatCell } from "@/lib/progress";
import { currentLearner } from "@/lib/session/current";
import { DIFFICULTIES } from "@/lib/policy/tiers";
import { relativeDay } from "@/lib/progress/summary";

export const dynamic = "force-dynamic";

/** One glyph per state, per docs/08: colour carries state and nothing else. */
const CELL: Record<string, { mark: string; tone: string; label: string }> = {
  untouched: { mark: "  ", tone: "text-text-faint", label: "not attempted" },
  attempted: { mark: "..", tone: "text-warn", label: "attempted, no pass" },
  passed:    { mark: "# ", tone: "text-info", label: "passed" },
  clean:     { mark: "##", tone: "text-pass", label: "passed clean" },
};

export default async function ProgressPage() {
  const learner = await currentLearner();
  const grid = await heatmap(learner.enrolmentId);
  const history = await attemptHistory(learner.enrolmentId);

  return (
    <main className="mx-auto max-w-5xl">
      <Nav active="progress" />

      <section className="border-b border-border px-4 py-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-text-dim">COMPETENCY HEATMAP</h1>
          <p className="tnum text-text-dim">
            {grid.cleanCells} of {grid.totalCells} cells clean, which is what readiness counts
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-text-dim">
                <th scope="col" className="py-1 pr-4 font-normal">Competency</th>
                {DIFFICULTIES.map((difficulty) => (
                  <th key={difficulty} scope="col" className="py-1 pr-4 font-normal capitalize">
                    {difficulty}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.rows.map((row) => (
                <tr key={row.slug} className="border-t border-border">
                  <th scope="row" className="py-1 pr-4 font-normal">{row.name}</th>
                  {row.cells.map((cell) => <Cell key={cell.difficulty} cell={cell} />)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <ul className="mt-3 flex flex-wrap gap-4 text-text-dim">
          {Object.entries(CELL).map(([state, look]) => (
            <li key={state} className="flex items-center gap-2">
              <span aria-hidden className={`font-mono ${look.tone}`}>[{look.mark}]</span>
              {look.label}
            </li>
          ))}
        </ul>
      </section>

      <section className="px-4 py-4">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-text-dim">ATTEMPT HISTORY</h2>
          {/* A plain anchor: this is a download, not a route transition, and
              Link would prefetch a CSV nobody asked for yet. */}
          <a href="/api/progress/export" className="text-accent" download>export csv</a>
        </div>

        {history.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-text-dim">
                  {["Date", "Problem", "Verdict", "Submits", "Hints", "Budget", "Defence"]
                    .map((head) => (
                      <th key={head} scope="col" className="py-1 pr-4 font-normal">{head}</th>
                    ))}
                </tr>
              </thead>
              <tbody>
                {history.map((row) => (
                  <tr key={row.slug} className="border-t border-border">
                    <td className="py-2 pr-4 text-text-dim">
                      {row.lastAt ? relativeDay(row.lastAt) : "not submitted"}
                    </td>
                    <td className="py-2 pr-4">
                      <Link href={`/problems/${row.slug}`} className="hover:text-accent">
                        {row.title}
                      </Link>
                      <span className="ml-2 capitalize text-text-faint">{row.difficulty}</span>
                    </td>
                    <td className={`py-2 pr-4 ${
                      row.verdict === "pass" ? "text-pass"
                        : row.verdict === null ? "text-text-faint" : "text-warn"}`}>
                      {row.verdict ?? "open"}
                    </td>
                    <td className="tnum py-2 pr-4">{row.submits}</td>
                    <td className="tnum py-2 pr-4">{row.hintsUsed}</td>
                    <td className="tnum py-2 pr-4 text-text-dim">
                      {row.bestBudgetCalls === null
                        ? "--"
                        : `${row.bestBudgetCalls}${row.callBudget ? ` of ${row.callBudget}` : ""}`}
                    </td>
                    <td className="tnum py-2 text-text-dim">
                      {row.defenceScore === null ? "--" : row.defenceScore}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-text-dim">
            Nothing attempted yet.{" "}
            <Link href="/" className="text-accent">Open the roadmap</Link> and start the first
            problem.
          </p>
        )}
      </section>
    </main>
  );
}

function Cell({ cell }: { cell: HeatCell }) {
  const look = CELL[cell.state]!;
  return (
    <td className="py-1 pr-4">
      <span className={`font-mono ${look.tone}`} title={`${cell.difficulty}: ${look.label}`}>
        [{look.mark}]
      </span>
      <span className="sr-only">{cell.difficulty} {look.label}</span>
    </td>
  );
}
