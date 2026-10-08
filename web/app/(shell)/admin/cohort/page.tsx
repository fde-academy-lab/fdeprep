/**
 * The cohort views beside the Overview: who is stuck, which competency the
 * cohort has not passed, and which interview rounds it has practised. docs/11
 * section 4, story S15.5.
 *
 * Faculty and admins, for the viewer's own cohort. The admin layout refuses a
 * learner, and this page asks the guard again so it never depends on where
 * it is mounted. Every number comes from lib/analytics, which reads what
 * eval/ wrote and computes no grade.
 *
 * "Stuck" means docs/11's learner and problem pair here, as in the Overview's
 * column. Ops lists submissions that are waiting in the queue, a different
 * thing under a different word.
 */
import Link from "next/link";
import type { Metadata, Route } from "next";
import { notFound } from "next/navigation";
import { Grid2x2, LifeBuoy } from "lucide-react";
import { permits } from "@/lib/admin/guard";
import { interviewCoverage } from "@/lib/analytics/coverage";
import { competencyGaps } from "@/lib/analytics/gaps";
import { STUCK_AT_FAILED_SUBMITS, stuckList } from "@/lib/analytics/stuck";
import { relativeDay } from "@/lib/progress/summary";
import { currentLearner } from "@/lib/session/current";
import { ButtonLink } from "@/components/ui/button";
import { DifficultyMeter } from "@/components/ui/difficulty";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeading, SectionHeading } from "@/components/ui/page";
import { Cell, Head, NumCell, Row, Table } from "@/components/ui/table";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Cohort" };

const ROUND_LABEL = { written: "Written", oral: "Oral" } as const;

const percent = (rate: number | null) => rate === null ? "none" : `${Math.round(rate * 100)}%`;

/** A competency's name in sentence case, as the heatmap writes it. */
const sentence = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

export default async function CohortPage() {
  const viewer = await currentLearner();
  if (!permits(viewer.role, "faculty")) notFound();

  const [stuck, gaps, coverage] = await Promise.all([
    stuckList(viewer.cohortId), competencyGaps(viewer.cohortId), interviewCoverage(viewer.cohortId),
  ]);
  const tried = gaps.rows.filter((row) => row.attempted > 0);
  const lowest = tried[0];

  return (
    <>
      <PageHeading title="Cohort" />

      <section aria-labelledby="stuck">
        <SectionHeading id="stuck" title="Stuck"
                        action={stuck.length ? `${stuck.length} ${stuck.length === 1 ? "pair" : "pairs"}` : undefined} />
        <p className="mt-1 text-text-dim">
          A learner and problem pair with {STUCK_AT_FAILED_SUBMITS} or more failed submits and no
          pass, newest failure first. The attempt note is what the learner wrote before asking for a
          hint.
        </p>
        {stuck.length ? (
          <Table className="mt-4" widths={[200, null, 96, 120, 72, 280]} head={
            <Head>
              <Cell head>Learner</Cell>
              <Cell head>Problem</Cell>
              <NumCell head>Failed submits</NumCell>
              <Cell head>Last failed</Cell>
              <NumCell head>Hints</NumCell>
              <Cell head>Attempt note</Cell>
            </Head>
          }>
            {stuck.map((row) => (
              <Row key={`${row.enrolmentId}-${row.problemId}`} className="hover:bg-surface-2">
                <Cell className="py-0.5! leading-[1.15]">
                  <Link href={`/admin/learners/${row.enrolmentId}` as Route}
                        className="font-medium text-text underline-offset-2 hover:underline">
                    {row.login}
                  </Link>
                  {row.state === "active" ? null : <span className="ml-2 text-meta text-text-faint">{row.state}</span>}
                  <div className="truncate text-meta leading-[1.15] text-text-faint">{row.displayName}</div>
                </Cell>
                <Cell className="py-0.5! leading-[1.15]">
                  <span className="text-text">{row.title}</span>
                  <div className="text-meta"><DifficultyMeter difficulty={row.difficulty} /></div>
                </Cell>
                <NumCell className="font-medium text-text">{row.failedSubmits}</NumCell>
                <Cell className="whitespace-nowrap text-text-dim">{relativeDay(row.lastFailedAt)}</Cell>
                <NumCell className="text-text-dim">{row.hintsUsed}</NumCell>
                <Cell className="truncate text-text-dim" title={row.note ?? undefined}>
                  {row.note ?? <span className="text-text-faint">None written</span>}
                </Cell>
              </Row>
            ))}
          </Table>
        ) : (
          <EmptyState icon={LifeBuoy} className="mt-4"
                      action={<ButtonLink href="/admin" size="sm">Open the Overview</ButtonLink>}>
            Nobody is stuck. The Overview shows who has gone quiet instead.
          </EmptyState>
        )}
      </section>

      <section aria-labelledby="gaps">
        <SectionHeading id="gaps" title="Competency gaps"
                        action={`${gaps.learners} active ${gaps.learners === 1 ? "learner" : "learners"}`} />
        {lowest ? (
          <>
            <p className="mt-1 text-text">
              Lowest pass rate: {sentence(lowest.name)}. {lowest.passed} of {lowest.attempted} learners
              who attempted it have passed it.
            </p>
            <Table className="mt-4" widths={[null, 96, 104, 88, 96, 104, 128]} head={
              <Head>
                <Cell head>Competency</Cell>
                <NumCell head>Attempted</NumCell>
                <NumCell head>Attempt rate</NumCell>
                <NumCell head>Passed</NumCell>
                <NumCell head>Pass rate</NumCell>
                <NumCell head>Not passed</NumCell>
                <NumCell head title="Each learner's best cell, from 1 attempted to 3 clean">Mean best state</NumCell>
              </Head>
            }>
              {gaps.rows.map((row) => (
                <Row key={row.slug}>
                  <Cell className="text-text">{sentence(row.name)}</Cell>
                  <NumCell className="text-text-dim">{row.attempted}</NumCell>
                  <NumCell className="text-text-dim">{percent(row.attemptRate)}</NumCell>
                  <NumCell className="text-text-dim">{row.passed}</NumCell>
                  <NumCell className="font-medium text-text">{percent(row.passRate)}</NumCell>
                  <NumCell className="text-text-dim">{row.attempted - row.passed}</NumCell>
                  <NumCell className="text-text-dim">
                    {row.meanBest === null ? "none" : `${row.meanBest.toFixed(1)} of 3`}
                  </NumCell>
                </Row>
              ))}
            </Table>
          </>
        ) : (
          <EmptyState icon={Grid2x2} className="mt-4"
                      action={<ButtonLink href="/admin" size="sm">Open the Overview</ButtonLink>}>
            No learner in this cohort has a competency cell yet. A cell fills in with a learner&apos;s
            first verdict, and the Overview shows who has started.
          </EmptyState>
        )}
      </section>

      <section aria-labelledby="coverage">
        <SectionHeading id="coverage" title="Interview coverage" />
        <p className="mt-1 text-text-dim">
          Published problems by the interview round they prepare for, and how many of them this
          cohort&apos;s active learners have practised. A problem marked both counts toward each round.
          Voice answers practise the oral round too and are not counted here.
        </p>
        <Table className="mt-4" widths={[null, 160, 200, 160]} head={
          <Head>
            <Cell head>Round</Cell>
            <NumCell head>In the catalogue</NumCell>
            <NumCell head>Practised by the cohort</NumCell>
            <NumCell head>Learners</NumCell>
          </Head>
        }>
          {coverage.rows.map((row) => (
            <Row key={row.round}>
              <Cell className="text-text">{ROUND_LABEL[row.round]}</Cell>
              <NumCell className="text-text-dim">{row.catalogue}</NumCell>
              <NumCell className="text-text-dim">{row.practised}</NumCell>
              <NumCell className="text-text-dim">{row.learners}</NumCell>
            </Row>
          ))}
        </Table>
        {coverage.undeclared ? (
          <p className="mt-2 text-meta text-text-faint">
            {coverage.undeclared} published {coverage.undeclared === 1 ? "problem declares" : "problems declare"} no
            round yet and count toward neither. Publishing a problem again from Problems fills it in.
          </p>
        ) : null}
      </section>
    </>
  );
}
