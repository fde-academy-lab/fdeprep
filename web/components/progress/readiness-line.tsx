/**
 * The readiness signal, drawn the one way it is drawn everywhere: the
 * percentage, its band, and the four counts it always travels with
 * (docs/12 section 2). Home, Progress and the cohort Overview hand it what
 * lib/progress/readiness.ts returned, so the three read one number from one
 * query.
 */
import Link from "next/link";
import type { Readiness, ReadinessBand } from "@/lib/progress/readiness";
import { SectionHeading } from "@/components/ui/page";
import { StatStrip } from "@/components/ui/stat-strip";

const BAND: Readonly<Record<ReadinessBand, string>> = {
  not_ready: "Not ready",
  developing: "Developing",
  screen_ready: "Screen ready",
};

export function ReadinessLine({ readiness, heatmapLink = true }: {
  readiness: Readiness;
  /** Off on Progress, where the heatmap is the next block down. */
  heatmapLink?: boolean;
}) {
  return (
    <section aria-labelledby="readiness">
      <SectionHeading id="readiness" title="Readiness"
                      action={heatmapLink ? <Link href="/progress" className="hover:text-text">Full heatmap</Link>
                        : undefined} />
      <p className="mt-4 flex items-baseline gap-3">
        <span className="tnum text-display font-semibold tracking-[-0.02em] text-text">
          {readiness.percent}%
        </span>
        <span className="text-text-dim">{BAND[readiness.band]}</span>
      </p>
      <StatStrip className="mt-4" cells={[
        { label: "Clean", value: readiness.clean },
        { label: "Passed", value: readiness.passed },
        { label: "Attempted", value: readiness.attempted },
        { label: "Untouched", value: readiness.untouched },
      ]} />
    </section>
  );
}
