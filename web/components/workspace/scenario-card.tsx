/**
 * The scenario card: who is asking, what happened, what it costs, and the
 * numbers that set the stakes. It sits above the brief so a learner meets a
 * situation before they meet a task.
 */
import { Building2 } from "lucide-react";
import type { Scenario } from "@/lib/problems/kit";
import { cn } from "@/components/ui/cn";
import { renderCode } from "@/components/ui/code";

export function ScenarioCard({ scenario }: { scenario: Scenario }) {
  const metrics = scenario.metrics.slice(0, 3);
  return (
    <section aria-label="The situation"
             className="@container overflow-hidden rounded-panel border border-border bg-surface">
      <div className="px-4 pb-4 pt-3.5">
        <p className="flex items-center gap-2 text-meta font-medium text-text-dim">
          <Building2 aria-hidden className="size-3.5" strokeWidth={1.9} />
          {renderCode(scenario.who)}
        </p>
        <p className="mt-2 text-lead leading-[1.45] text-text">{renderCode(scenario.situation)}</p>
        <p className="mt-2 text-text-dim">{renderCode(scenario.stakes)}</p>
      </div>
      {metrics.length ? (
        // A narrow card stacks the figures as label and value rows, because
        // three columns in a phone's width cut every label to a word.
        <dl className={cn("grid divide-y divide-border border-t border-border bg-surface-2/60",
                          "@md:divide-x @md:divide-y-0",
                          metrics.length === 2 ? "@md:grid-cols-2"
                            : metrics.length === 3 ? "@md:grid-cols-3" : "")}>
          {metrics.map((metric) => (
            <div key={metric.label}
                 className="flex min-w-0 items-baseline justify-between gap-4 px-4 py-2.5 @md:block">
              <dt className="text-meta text-text-faint @md:truncate">{renderCode(metric.label)}</dt>
              <dd className="tnum shrink-0 text-lead font-semibold tracking-[-0.01em] text-text
                             @md:mt-0.5 @md:truncate @md:text-title">
                {renderCode(metric.value)}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}
