/**
 * S10 Disagreements: what the panel argued about, and what faculty decided.
 *
 * docs/10 section 9.7 says a two-band disagreement is marked on the record, the
 * lower band is held, and the row is surfaced to faculty. This is the surfacing.
 * Holding the lower band hands the grade to the more cautious voice, and until
 * this screen existed nobody could see when that voice was an unvalidated
 * panelist rather than the judge.
 *
 * Read the row left to right and the question answers itself: this learner got
 * `held`, one panelist said so and another said something two steps away.
 */
import Link from "next/link";
import type { Metadata, Route } from "next";
import { Scale, SearchX } from "lucide-react";
import { disagreementQueue, type Disposition, type QueueFilter } from "@/lib/eval/review";
import { BAND_WORD } from "@/lib/policy/bands";
import { relativeDay } from "@/lib/progress/summary";
import { Button, ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select } from "@/components/ui/field";
import { PageHeading } from "@/components/ui/page";
import { Cell, Head, NumCell, Row, Table } from "@/components/ui/table";
import { OverrideAction, ReviewActions } from "./review-button";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Disagreements" };

const FILTERS: Array<{ value: QueueFilter; label: string }> = [
  { value: "open", label: "Open" },
  { value: "disputed", label: "Band disputed" },
  { value: "problem_flagged", label: "Problem flagged" },
  { value: "upheld", label: "Upheld" },
  { value: "all", label: "All" },
];

/** A decided row names its reading the way the Show filter does. */
const DECIDED: Readonly<Record<Disposition, string>> = {
  upheld: "Upheld",
  disputed: "Band disputed",
  problem_flagged: "Problem flagged",
};

type Params = Record<string, string | string[] | undefined>;
const one = (params: Params, key: string) =>
  (Array.isArray(params[key]) ? params[key][0] : params[key]) ?? "";

function isFilter(value: string): value is QueueFilter {
  return FILTERS.some((f) => f.value === value);
}

export default async function DisagreementsPage({ searchParams }: {
  searchParams: Promise<Params>;
}) {
  const params = await searchParams;
  const chosen = one(params, "show");
  const disposition: QueueFilter = isFilter(chosen) ? chosen : "open";
  const slug = one(params, "slug").trim();

  const queue = await disagreementQueue({
    disposition,
    slug: slug || undefined,
  });

  return (
    <>
      <PageHeading title="Disagreements"
                   line="Two panelists landed more than one band apart on these answers. The learner was given the lower of the two. Decide whether that was right." />

      <form method="get" className="flex flex-wrap items-end gap-3">
        <Field label="Show" className="w-44">
          <Select name="show" defaultValue={disposition}>
            {FILTERS.map((filter) => (
              <option key={filter.value} value={filter.value}>{filter.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Problem" className="w-72">
          <Input name="slug" defaultValue={slug} placeholder="slug" autoComplete="off" spellCheck={false} />
        </Field>
        <Button type="submit">Filter</Button>
      </form>

      {queue.rows.length === 0 ? (
        disposition === "open" && !slug ? (
          <EmptyState icon={Scale}>
            Nothing to review. A new row appears here when two panelists land two bands apart.
          </EmptyState>
        ) : (
          <EmptyState icon={SearchX}
                      action={<ButtonLink href="/admin/disagreements" size="sm">Show open</ButtonLink>}>
            No rows under this filter. Switch Show to Open to work the queue.
          </EmptyState>
        )
      ) : (
        <section aria-label="Disagreements found" className="space-y-3">
          <p className="tnum text-text-dim">
            {queue.rows.length} shown, {queue.open} still to review
          </p>
          <Table head={
            <Head>
              <Cell head>When</Cell>
              <Cell head>Learner</Cell>
              <Cell head>Problem</Cell>
              <Cell head>Level</Cell>
              <Cell head>The argument</Cell>
              <Cell head>Given</Cell>
              <NumCell head>Score</NumCell>
              <Cell head>Decided</Cell>
            </Head>
          }>
            {queue.rows.map((row) => (
              <Row key={row.evaluationId} className="align-top">
                <Cell className="whitespace-nowrap text-text-dim">{relativeDay(row.createdAt)}</Cell>
                <Cell className="whitespace-nowrap text-text">{row.login}</Cell>
                <Cell>
                  <Link href={`/admin/submissions?slug=${row.slug}` as Route}
                        className="text-text underline-offset-2 hover:underline">{row.title}</Link>
                </Cell>
                <Cell className="tnum text-text-dim">{row.complexity}</Cell>
                <Cell>
                  {/* Who said what is the row's reason for existing. A reviewer
                      seeing only "weak against strong" cannot tell the judge
                      being overruled from the judge overruling. */}
                  {Object.entries(row.byPanelist).map(([panelist, band]) => (
                    <div key={panelist} className="whitespace-nowrap text-text-dim">
                      {panelist} said <span className="text-text">{BAND_WORD[band]}</span>
                    </div>
                  ))}
                </Cell>
                <Cell className="text-warn">{BAND_WORD[row.held]}</Cell>
                <NumCell className="text-text">{row.score}</NumCell>
                <Cell>
                  {row.review ? (
                    <div className="space-y-1">
                      <div className="text-text">{DECIDED[row.review.disposition]}</div>
                      <div className="text-meta text-text-faint">
                        {row.review.reviewer}: {row.review.note}
                      </div>
                      {/* A grade somebody has already called wrong is the one
                          worth offering to fix, so the action appears here
                          rather than beside every unread row. */}
                      {row.review.disposition === "disputed" ? (
                        <OverrideAction evaluationId={row.evaluationId} held={row.held} />
                      ) : null}
                    </div>
                  ) : (
                    <ReviewActions evaluationId={row.evaluationId} />
                  )}
                </Cell>
              </Row>
            ))}
          </Table>
        </section>
      )}
    </>
  );
}
