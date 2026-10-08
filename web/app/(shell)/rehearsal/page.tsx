/**
 * The rehearsal entry, S8.
 *
 * "Entering rehearsal requires a confirmation that names the duration and the
 * remaining weekly allowance." Both numbers come from the modules that own
 * them rather than being restated here.
 */
import Link from "next/link";
import type { Metadata, Route } from "next";
import { Timer } from "lucide-react";
import { DURATION_MINUTES, PROBLEM_COUNT } from "@/lib/rehearsal";
import { allowanceFor } from "@/lib/policy";
import { currentLearner } from "@/lib/session/current";
import { db } from "@/lib/db/pool";
import { EmptyState } from "@/components/ui/empty-state";
import { Page, PageHeading, SectionHeading } from "@/components/ui/page";
import { StatStrip } from "@/components/ui/stat-strip";
import { StatusIcon } from "@/components/ui/status";
import { Cell, Head, NumCell, Row, Table } from "@/components/ui/table";
import StartButton from "./start-button";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Rehearsal" };

export default async function RehearsalPage() {
  const learner = await currentLearner();
  const allowance = await allowanceFor({
    enrolmentId: learner.enrolmentId, difficulty: "extreme", scope: "rehearsal_weekly",
  });

  const { rows: past } = await db().query<{
    id: string; started_at: Date; finished_at: Date | null; report: { score?: number } | null;
  }>(
    `select id, started_at, finished_at, report from rehearsal
      where enrolment_id = $1 order by started_at desc limit 8`, [learner.enrolmentId]);

  return (
    <Page>
      <div>
        {/* The words restate PROBLEM_COUNT and DURATION_MINUTES, which the facts below read. */}
        <PageHeading title="Rehearsal"
                     line="Three problems from your path under screen conditions: the brief only, a blank editor, no hints, no coach, one submit each, sixty minutes." />
        <StatStrip className="mt-6" cells={[
          { label: "Length", value: `${DURATION_MINUTES} min` },
          { label: "Problems", value: PROBLEM_COUNT },
          { label: "Left this week", value: `${allowance.remaining} of ${allowance.max}` },
          { label: "Order", value: "Fixed" },
        ]} />
        <div className="mt-6">
          {allowance.remaining > 0 ? (
            <StartButton durationMinutes={DURATION_MINUTES} problemCount={PROBLEM_COUNT}
                         remaining={allowance.remaining} />
          ) : (
            <p className="rounded-control border border-warn/40 bg-warn-soft px-3 py-2.5 text-text">
              You have used both rehearsals this week. The next one opens in{" "}
              {allowance.resetInS === null ? "a while" : humanise(allowance.resetInS)}.
            </p>
          )}
        </div>
      </div>

      <section aria-labelledby="sittings">
        <SectionHeading id="sittings" title="Past sittings" />
        {past.length ? (
          <Table className="mt-4" widths={[200, null, 96]} head={
            <Head>
              <Cell head>Date</Cell>
              <Cell head>State</Cell>
              <NumCell head>Score</NumCell>
            </Head>
          }>
            {past.map((row) => (
              <Row key={row.id} className="hover:bg-surface-2">
                <Cell>
                  <Link href={`/rehearsal/${row.id}` as Route} className="font-medium text-text hover:text-accent">
                    {row.started_at.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                  </Link>
                </Cell>
                <Cell>
                  <span className="inline-flex items-center gap-1.5 text-text-dim">
                    <StatusIcon kind={row.finished_at ? "pass" : "running"}
                                label={row.finished_at ? "Finished" : "In progress"} />
                    {row.finished_at ? "Finished, report ready" : "Not finished, resume it"}
                  </span>
                </Cell>
                <NumCell className="text-text">
                  {row.report?.score === undefined ? "" : Math.round(row.report.score)}
                </NumCell>
              </Row>
            ))}
          </Table>
        ) : (
          <EmptyState icon={Timer} className="mt-4">
            No sittings yet. Press Start a rehearsal when you can give it {DURATION_MINUTES} uninterrupted
            minutes.
          </EmptyState>
        )}
      </section>
    </Page>
  );
}

function humanise(seconds: number): string {
  const hours = Math.ceil(seconds / 3600);
  if (hours < 24) return `${hours} hours`;
  const days = Math.ceil(hours / 24);
  return days === 1 ? "a day" : `${days} days`;
}
