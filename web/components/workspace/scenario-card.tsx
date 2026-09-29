/**
 * The scenario card: who is asking, what happened, what it costs, and the
 * numbers that set the stakes. It sits above the brief so a learner meets a
 * situation before they meet a task.
 */
import { Building2 } from "lucide-react";
import type { Scenario } from "@/lib/problems/kit";
import { cn } from "@/components/ui/cn";

export function ScenarioCard({ scenario }: { scenario: Scenario }) {
  const metrics = scenario.metrics.slice(0, 3);
  return (
    <section aria-label="The situation"
             className="overflow-hidden rounded-panel border border-border bg-surface">
      <div className="px-4 pb-4 pt-3.5">
        <p className="flex items-center gap-2 text-meta font-medium text-text-dim">
          <Building2 aria-hidden className="size-3.5" strokeWidth={1.9} />
          {scenario.who}
        </p>
        <p className="mt-2 text-lead leading-[1.45] text-text">{scenario.situation}</p>
        <p className="mt-2 text-text-dim">{scenario.stakes}</p>
      </div>
      {metrics.length ? (
        <dl className={cn("grid divide-x divide-border border-t border-border bg-surface-2/60",
                          metrics.length === 1 ? "grid-cols-1"
                            : metrics.length === 2 ? "grid-cols-2" : "grid-cols-3")}>
          {metrics.map((metric) => (
            <div key={metric.label} className="min-w-0 px-4 py-2.5">
              <dt className="truncate text-meta text-text-faint">{metric.label}</dt>
              <dd className="tnum mt-0.5 truncate text-title font-semibold tracking-[-0.01em]
                             text-text">
                {metric.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}
