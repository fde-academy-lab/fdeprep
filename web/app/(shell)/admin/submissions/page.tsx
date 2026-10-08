/** S10 Submissions: filterable by learner, problem, verdict and date, with a link to every trace. */
import Link from "next/link";
import type { Metadata, Route } from "next";
import { Inbox, SearchX } from "lucide-react";
import { browseSubmissions, type BrowserRow } from "@/lib/admin/submissions";
import { relativeDay } from "@/lib/progress/summary";
import { Button, ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select } from "@/components/ui/field";
import { PageHeading } from "@/components/ui/page";
import { StatusIcon, type StatusKind } from "@/components/ui/status";
import { Cell, Head, NumCell, Row, Table } from "@/components/ui/table";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Submissions" };

/** The Verdict filter. Queued and Running are where a submission waits before it has one. */
const VERDICTS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "all", label: "Any verdict" },
  { value: "pass", label: "Passed" },
  { value: "fail", label: "Failed" },
  { value: "error", label: "Error" },
  { value: "timeout", label: "Timed out" },
  { value: "rejected", label: "Rejected" },
  { value: "queued", label: "Queued" },
  { value: "running", label: "Running" },
];

/**
 * The glyph and the word for a row. A submission still running shows the
 * waiting glyph: this table is a snapshot, and a spinner on it would claim a
 * progress nothing here is watching.
 */
function verdictOf(row: BrowserRow): { kind: StatusKind; word: string } {
  switch (row.verdict) {
    case "pass": return { kind: "pass", word: "Passed" };
    case "fail": return { kind: "fail", word: "Failed" };
    case "error": return { kind: "error", word: "Error" };
    case "timeout": return { kind: "fail", word: "Timed out" };
    case "rejected": return { kind: "fail", word: "Rejected" };
    case "cancelled": return { kind: "untouched", word: "Cancelled" };
    default: return { kind: "queued", word: row.status === "queued" ? "Queued" : "Running" };
  }
}

type Params = Record<string, string | string[] | undefined>;
const one = (params: Params, key: string) =>
  (Array.isArray(params[key]) ? params[key][0] : params[key]) ?? "";

/** A real calendar day as YYYY-MM-DD, or nothing: a date that is not one falls back to no filter. */
function day(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value) ? value : "";
}

export default async function SubmissionsPage({ searchParams }: {
  searchParams: Promise<Params>;
}) {
  const params = await searchParams;
  const filters = {
    login: one(params, "login").trim(),
    slug: one(params, "slug").trim(),
    verdict: VERDICTS.some((v) => v.value === one(params, "verdict")) ? one(params, "verdict") : "all",
    since: day(one(params, "since")),
  };
  const filtered = Boolean(filters.login || filters.slug || filters.verdict !== "all" || filters.since);
  const page = await browseSubmissions({
    login: filters.login || undefined,
    slug: filters.slug || undefined,
    verdict: filters.verdict,
    since: filters.since || undefined,
    page: Number(one(params, "page")) || 1,
  });

  return (
    <>
      <PageHeading title="Submissions" />

      <form method="get" className="flex flex-wrap items-end gap-3">
        <Field label="Learner" className="w-52">
          <Input name="login" defaultValue={filters.login} placeholder="github login"
                 autoComplete="off" spellCheck={false} />
        </Field>
        <Field label="Problem" className="w-72">
          <Input name="slug" defaultValue={filters.slug} placeholder="slug" autoComplete="off" spellCheck={false} />
        </Field>
        <Field label="Verdict" className="w-44">
          <Select name="verdict" defaultValue={filters.verdict}>
            {VERDICTS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
          </Select>
        </Field>
        <Field label="Since" className="w-44">
          <Input name="since" type="date" defaultValue={filters.since} />
        </Field>
        <Button type="submit">Filter</Button>
      </form>

      {page.rows.length === 0 ? (
        filtered ? (
          <EmptyState icon={SearchX}
                      action={<ButtonLink href="/admin/submissions" size="sm">Clear filters</ButtonLink>}>
            No submission matches. Clear a filter, or widen the date.
          </EmptyState>
        ) : (
          <EmptyState icon={Inbox}>
            No submissions yet. The first Run or Submit from any learner lands here.
          </EmptyState>
        )
      ) : (
        <section aria-label="Submissions found" className="space-y-3">
          <p className="tnum text-text-dim">
            {page.total} {page.total === 1 ? "submission" : "submissions"}
          </p>
          <Table head={
            <Head>
              <Cell head>When</Cell>
              <Cell head>Learner</Cell>
              <Cell head>Problem</Cell>
              <Cell head>Kind</Cell>
              <Cell head>Verdict</Cell>
              <NumCell head>Score</NumCell>
              <Cell head>Trace</Cell>
            </Head>
          }>
            {page.rows.map((row) => {
              const verdict = verdictOf(row);
              return (
                <Row key={row.id}>
                  <Cell className="whitespace-nowrap text-text-dim">{relativeDay(row.queuedAt)}</Cell>
                  <Cell className="text-text">{row.login}</Cell>
                  <Cell className="text-text-dim">{row.slug}</Cell>
                  <Cell className="text-text-dim">{row.kind.replace("_", " ")}</Cell>
                  <Cell>
                    <span className="inline-flex items-center gap-1.5 text-text-dim">
                      <StatusIcon kind={verdict.kind} label={verdict.word} />
                      <span aria-hidden>{verdict.word}</span>
                    </span>
                  </Cell>
                  <NumCell className="text-text">{row.score}</NumCell>
                  <Cell>
                    {row.hasTrace ? (
                      <Link href={`/traces/${row.id}` as Route}
                            className="text-text-dim underline-offset-2 hover:text-text hover:underline">
                        Trace
                      </Link>
                    ) : null}
                  </Cell>
                </Row>
              );
            })}
          </Table>
        </section>
      )}
    </>
  );
}
