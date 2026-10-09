/**
 * The calibration report, for the author before the next cohort. docs/11
 * section 5, story S15.5.
 *
 * Every problem across every cohort, each signal with its number, the sample
 * behind it and what to check first, then how much panelist 2's index holds
 * per problem. Faculty and admins: it names problems and no learner. The same
 * report downloads as Markdown (docs/11 section 7).
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Download, Gauge, Library } from "lucide-react";
import { permits } from "@/lib/admin/guard";
import { calibrationReport, SIGNAL_LABEL } from "@/lib/analytics/calibration";
import { currentLearner } from "@/lib/session/current";
import { DifficultyMeter } from "@/components/ui/difficulty";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeading, SectionHeading } from "@/components/ui/page";
import { Cell, Head, NumCell, Row, Table } from "@/components/ui/table";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Calibration" };

export default async function CalibrationPage() {
  const viewer = await currentLearner();
  if (!permits(viewer.role, "faculty")) notFound();
  const report = await calibrationReport();

  return (
    <>
      <PageHeading title="Calibration"
                   line={`${report.problems} published problems across every cohort. A threshold is a reason to look, and a problem named here may be fine.`}
                   action={
        // A plain anchor: a download, which Link would prefetch.
        <a href="/api/admin/calibration" download
           className="inline-flex h-8 items-center gap-1.5 rounded-control border border-border-strong
                      bg-surface-2 px-3 font-medium text-text hover:border-border-control hover:bg-surface-3">
          <Download aria-hidden className="size-4" /> Download Markdown
        </a>
      } />

      <section aria-labelledby="signals">
        <SectionHeading id="signals" title="Signals"
                        action={report.findings.length ? `${report.findings.length} found` : undefined} />
        {report.findings.length ? (
          <Table className="mt-4" widths={[240, 180, null, 80, 280]} head={
            <Head>
              <Cell head>Problem</Cell>
              <Cell head>Signal</Cell>
              <Cell head>Number</Cell>
              <NumCell head>Sample</NumCell>
              <Cell head>Check first</Cell>
            </Head>
          }>
            {report.findings.map((finding) => (
              <Row key={`${finding.slug}-${finding.signal}`}>
                <Cell className="py-1! leading-[1.2]">
                  <span className="text-text">{finding.title}</span>
                  <div className="text-meta"><DifficultyMeter difficulty={finding.difficulty} /></div>
                </Cell>
                <Cell className="text-text-dim">{SIGNAL_LABEL[finding.signal]}</Cell>
                <Cell className="py-1! leading-[1.3] text-text">{finding.says}</Cell>
                <NumCell className="text-text-dim">{finding.sample}</NumCell>
                <Cell className="py-1! leading-[1.3] text-text-dim">{finding.check}</Cell>
              </Row>
            ))}
          </Table>
        ) : (
          <EmptyState icon={Gauge} className="mt-4">
            No problem crosses a threshold yet. A signal needs at least {report.minSample} learners or
            evaluations behind it, so look again once the cohort has a week of submits.
          </EmptyState>
        )}
      </section>

      <section aria-labelledby="index">
        <SectionHeading id="index" title="Panelist 2's index" />
        <p className="mt-1 text-text-dim">
          Graded answers in the nearest-neighbour index for each design and prompt problem. A band
          on a problem holding only its authored exemplars rests on those few points.
        </p>
        {report.index.length ? (
          <Table className="mt-4" widths={[null, 180, 180]} head={
            <Head>
              <Cell head>Problem</Cell>
              <NumCell head>Authored exemplars</NumCell>
              <NumCell head>Graded answers</NumCell>
            </Head>
          }>
            {report.index.map((row) => (
              <Row key={row.slug}>
                <Cell className="text-text">{row.title}</Cell>
                <NumCell className="text-text-dim">{row.exemplars}</NumCell>
                <NumCell className="text-text-dim">{row.graded}</NumCell>
              </Row>
            ))}
          </Table>
        ) : (
          <EmptyState icon={Library} className="mt-4">
            No design or prompt problem is published. Publish one from Problems, and its exemplars
            enter the index the first time an answer to it is graded.
          </EmptyState>
        )}
      </section>
    </>
  );
}
