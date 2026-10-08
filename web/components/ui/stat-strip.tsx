/**
 * A row of facts, each a label over a figure: the learner's position on Home,
 * the four readiness counts, a rehearsal's terms. One object for what four
 * pages each drew their own way.
 */
import type { ReactNode } from "react";
import { cn } from "./cn";

/** Whole class strings, so Tailwind sees every one. Up to six cells. */
const COLUMNS = ["", "grid-cols-1", "grid-cols-2", "grid-cols-3", "grid-cols-4", "grid-cols-5",
                 "grid-cols-6"] as const;

export function StatStrip({ cells, columns, className }: {
  /** A note is a line under the figure saying what it means, such as "draining normally". */
  cells: ReadonlyArray<{ label: string; value: ReactNode; note?: ReactNode }>;
  /** A grid-cols class in place of equal columns, for a value too long to share a quarter. */
  columns?: string;
  className?: string;
}) {
  return (
    <dl className={cn("grid divide-x divide-border rounded-panel border border-border bg-surface",
                      columns ?? COLUMNS[Math.min(cells.length, 6)], className)}>
      {cells.map((cell) => (
        <div key={cell.label} className="min-w-0 px-3 pb-3">
          <dt className="flex h-9 items-center text-meta text-text-faint">{cell.label}</dt>
          <dd className="tnum text-title font-semibold tracking-[-0.01em] text-text">
            {cell.value}
          </dd>
          {cell.note ? <dd className="mt-0.5 text-meta text-text-faint">{cell.note}</dd> : null}
        </div>
      ))}
    </dl>
  );
}
