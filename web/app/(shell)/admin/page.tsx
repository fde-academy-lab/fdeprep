/**
 * The cohort Overview, the first admin tab (docs/01 S10, amended 8 October
 * 2026). Four numbers, then one row per learner: readiness with its four
 * counts, last activity including voice, and how many problems they are stuck
 * on. A row opens that learner's page.
 *
 * Sorting is a query parameter on a plain link, as the Problems filters are,
 * so the page works without JavaScript.
 *
 * The page checks the role itself, because the admin layout does not stop
 * the page under it from rendering (S15.13).
 */
import Link from "next/link";
import type { Metadata, Route } from "next";
import { notFound } from "next/navigation";
import { ArrowDown, ArrowUp, Download, Users } from "lucide-react";
import { permits } from "@/lib/admin/guard";
import {
  overview, sortRows, type OverviewSort, type SortDirection,
} from "@/lib/admin/overview";
import { relativeDay } from "@/lib/progress/summary";
import { currentLearner } from "@/lib/session/current";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeading } from "@/components/ui/page";
import { StatStrip } from "@/components/ui/stat-strip";
import { Cell, Head, NumCell, Row, Table } from "@/components/ui/table";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Overview" };

type Params = Record<string, string | string[] | undefined>;
const one = (params: Params, key: string) =>
  (Array.isArray(params[key]) ? params[key][0] : params[key]) ?? "";

const SORTS: readonly OverviewSort[] = ["activity", "readiness", "stuck"];

export default async function OverviewPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const sort = SORTS.find((s) => s === one(params, "sort")) ?? "activity";
  const direction: SortDirection = one(params, "dir") === "asc" ? "asc" : "desc";

  const learner = await currentLearner();
  if (!permits(learner.role, "faculty")) notFound();
  const cohort = await overview(learner.cohortId);
  const rows = sortRows(cohort.rows, sort, direction);

  const cells = [
    { label: "Active in 7 days", value: cohort.activeThisWeek },
    { label: "Submissions this week", value: cohort.submissionsThisWeek },
    { label: "Stuck", value: cohort.stuck },
    // The Disagreements tab's own count, which lists every cohort, so the two agree.
    { label: "Disagreements open, all cohorts", value: cohort.disagreementsOpen },
  ];

  /** A column header that sorts: newest or highest first, and the other way on a second click. */
  const sorter = (key: OverviewSort, label: string) => {
    const on = sort === key;
    const next: SortDirection = on && direction === "desc" ? "asc" : "desc";
    const query: Record<string, string> = key === "activity" && next === "desc" ? {} : { sort: key, dir: next };
    const Arrow = direction === "asc" ? ArrowUp : ArrowDown;
    return {
      "aria-sort": on ? (direction === "asc" ? "ascending" as const : "descending" as const) : undefined,
      children: (
        <Link href={{ pathname: "/admin", query }}
              className={on ? "inline-flex items-center gap-1 text-text" : "inline-flex items-center gap-1 hover:text-text"}>
          {label}
          {on ? <Arrow aria-hidden className="size-3.5" /> : null}
        </Link>
      ),
    };
  };

  return (
    <>
      <PageHeading title="Overview" action={rows.length ? (
        // A plain anchor: a download, which Link would prefetch. docs/11 section 7.
        <a href="/api/admin/cohort/standing" download
           className="inline-flex h-8 items-center gap-1.5 rounded-control border border-border-strong
                      bg-surface-2 px-3 font-medium text-text hover:border-border-control hover:bg-surface-3">
          <Download aria-hidden className="size-4" /> Export CSV
        </a>
      ) : undefined} />
      <StatStrip cells={cells} />

      {rows.length === 0 ? (
        <EmptyState icon={Users}
                    action={learner.role === "admin" ? (
                      <ButtonLink href={"/admin/roster#invite" as Route} size="sm" variant="primary">
                        Invite a tester
                      </ButtonLink>
                    ) : undefined}>
          Nobody is enrolled in this cohort yet. Invite the first tester from the Roster.
        </EmptyState>
      ) : (
        <Table widths={[null, 110, 100, 100, 72, 72, 88, 88, 120, 72]} head={
          <Head>
            <Cell head>Learner</Cell>
            <Cell head>Persona</Cell>
            <NumCell head>Day reached</NumCell>
            <NumCell head {...sorter("readiness", "Readiness")} />
            <NumCell head>Clean</NumCell>
            <NumCell head>Passed</NumCell>
            <NumCell head>Attempted</NumCell>
            <NumCell head>Untouched</NumCell>
            <Cell head {...sorter("activity", "Last activity")} />
            <NumCell head {...sorter("stuck", "Stuck")} />
          </Head>
        }>
          {rows.map((row) => (
            <Row key={row.enrolmentId} className="hover:bg-surface-2">
              {/* Two lines inside the 36 pixel row, so forty learners still read at a glance. */}
              <Cell className="py-0.5! leading-[1.15]">
                <Link href={`/admin/learners/${row.enrolmentId}` as Route}
                      className="font-medium text-text underline-offset-2 hover:underline">
                  {row.login}
                </Link>
                {row.state === "active" ? null : <span className="ml-2 text-meta leading-[1.15] text-text-faint">{row.state}</span>}
                <div className="truncate text-meta leading-[1.15] text-text-faint">{row.displayName}</div>
              </Cell>
              <Cell className="capitalize text-text-dim">{row.persona}</Cell>
              <NumCell className={row.dayReached === null ? "text-text-faint" : "text-text-dim"}>
                {row.dayReached ?? "none"}
              </NumCell>
              <NumCell className="text-text">{row.readiness ? `${row.readiness.percent}%` : null}</NumCell>
              <NumCell className="text-text-dim">{row.readiness?.clean}</NumCell>
              <NumCell className="text-text-dim">{row.readiness?.passed}</NumCell>
              <NumCell className="text-text-dim">{row.readiness?.attempted}</NumCell>
              <NumCell className="text-text-dim">{row.readiness?.untouched}</NumCell>
              <Cell className="whitespace-nowrap text-text-dim">
                {row.lastActivity ? relativeDay(row.lastActivity) : "never"}
              </Cell>
              <NumCell className="font-medium text-text">{row.stuck || null}</NumCell>
            </Row>
          ))}
        </Table>
      )}
    </>
  );
}
