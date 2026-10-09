/**
 * Panel health, read daily by whoever operates the platform. docs/11 section 6,
 * story S15.5.
 *
 * Whether the evaluation system is working, which is a different question
 * from whether learners are. Admin only, like Ops: it names panelists, and
 * provenance is for staff. The re-evaluation backlog is the number with teeth,
 * because every partial evaluation is a free re-run the platform owes.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Activity } from "lucide-react";
import { permits } from "@/lib/admin/guard";
import { availability, PANELISTS, panelHealth } from "@/lib/analytics/panel-health";
import { relativeDay } from "@/lib/progress/summary";
import { currentLearner } from "@/lib/session/current";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeading, SectionHeading } from "@/components/ui/page";
import { StatStrip } from "@/components/ui/stat-strip";
import { Cell, Head, NumCell, Row, Table } from "@/components/ui/table";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Panel" };

const PANELIST_LABEL = { static: "P1 static", pretrained: "P2 pretrained", llm: "P3 judge" } as const;

const percent = (rate: number | null) => rate === null ? "none" : `${Math.round(rate * 100)}%`;
const ms = (value: number | null) => value === null ? "none" : `${value.toLocaleString("en-GB")} ms`;
const runs = (n: number) => `${n} ${n === 1 ? "run" : "runs"}`;

/** "8 Oct 14:00 UTC": written here, so the browser cannot render it in another time zone. */
function hourLabel(iso: string): string {
  const at = new Date(iso);
  const day = at.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  const time = at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false,
                                                 timeZone: "UTC" });
  return `${day} ${time} UTC`;
}

export default async function PanelPage() {
  const viewer = await currentLearner();
  if (!permits(viewer.role, "admin")) notFound();
  const health = await panelHealth();

  return (
    <>
      <PageHeading title="Panel"
                   line="A panel run is one evaluation the panel wrote. A re-run counts as a run of its own, and a faculty correction is left out." />

      <StatStrip cells={[
        { label: `Panel runs, ${health.days} days`, value: health.runs },
        {
          label: "Partial",
          value: <span className={health.partial ? "text-warn" : undefined}>{percent(health.partialRate)}</span>,
          note: `${health.partial} of ${runs(health.runs)}`,
        },
        { label: "Errors", value: health.errors, note: "P1 could not run" },
        {
          label: "Re-evaluations owed",
          value: <span className={health.backlog ? "text-warn" : undefined}>{health.backlog}</span>,
          note: health.oldestOwedAt ? `oldest ${relativeDay(health.oldestOwedAt)}` : "none owed",
        },
        {
          label: "Disagreement",
          value: percent(health.disagreementRate),
          note: `${health.disagreements} of ${runs(health.banded)} with two bands`,
        },
      ]} />

      <section aria-labelledby="latency">
        <SectionHeading id="latency" title={`P3 judge, ${health.days} days`} />
        <p className="mt-1 text-text-dim">
          When the judge misses its deadline the evaluation goes partial, so a p95 near the deadline
          says the deadline is wrong.
        </p>
        <StatStrip className="mt-4" cells={[
          { label: "Median", value: ms(health.llm.medianMs) },
          { label: "p95", value: ms(health.llm.p95Ms) },
          { label: "Ran", value: health.llm.ran },
          { label: "Unavailable", value: health.llm.unavailable },
        ]} />
      </section>

      <section aria-labelledby="availability">
        <SectionHeading id="availability" title="Panelist availability, last 24 hours" />
        <p className="mt-1 text-text-dim">
          Of the runs that asked a panelist for an answer, the share it gave. A panelist the problem
          did not ask for, or this deployment does not have, reads none.
        </p>
        {health.hours.length ? (
          <Table className="mt-4" widths={[null, 96, 140, 140, 140]} head={
            <Head>
              <Cell head>Hour</Cell>
              <NumCell head>Runs</NumCell>
              {PANELISTS.map((panelist) => <NumCell key={panelist} head>{PANELIST_LABEL[panelist]}</NumCell>)}
            </Head>
          }>
            {health.hours.map((hour) => (
              <Row key={hour.hour}>
                <Cell className="whitespace-nowrap text-text">{hourLabel(hour.hour)}</Cell>
                <NumCell className="text-text-dim">{hour.runs}</NumCell>
                {PANELISTS.map((panelist) => {
                  const share = availability(hour.seats[panelist]);
                  return (
                    <NumCell key={panelist}
                             className={share !== null && share < 1 ? "text-warn" : "text-text-dim"}>
                      {percent(share)}
                    </NumCell>
                  );
                })}
              </Row>
            ))}
          </Table>
        ) : (
          <EmptyState icon={Activity} className="mt-4">
            No evaluation ran in the last 24 hours. A row appears for each hour a submission is graded.
          </EmptyState>
        )}
      </section>
    </>
  );
}
