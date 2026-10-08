/**
 * The competency heatmap, S9: thirteen competencies by four tiers, drawn from
 * what heatmap() in lib/progress read out of competency_score. Progress shows
 * a learner their own, and the admin learner page shows faculty the same grid.
 *
 * The heatmap is the readiness signal, so the fourth state is drawn
 * differently from the other three: docs/02 section 7 counts clean only, and a
 * grid where passed and clean look alike hides the distinction the whole
 * scoring model exists to make. Every cell carries a glyph as well as a
 * colour, so the grid reads the same to someone who cannot tell the colours
 * apart.
 */
import type { ReactNode } from "react";
import { Check, CircleDot, Minus } from "lucide-react";
import type { HeatCell, Heatmap } from "@/lib/progress";
import { DIFFICULTIES, difficultyLabel } from "@/lib/policy/tiers";
import { DifficultyMeter } from "@/components/ui/difficulty";
import { cn } from "@/components/ui/cn";

const CELL: Record<string, { label: string; box: string; icon: ReactNode }> = {
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

/** No cell has been touched, which is when a page shows its empty line. */
export function untouched(grid: Heatmap): boolean {
  return grid.rows.every((row) => row.cells.every((cell) => cell.state === "untouched"));
}

/** The heading, the grid and its legend. A page puts its empty line in `children`. */
export function CompetencyHeatmap({ grid, children }: { grid: Heatmap; children?: ReactNode }) {
  return (
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
      {children}
    </section>
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
