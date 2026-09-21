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
import { disagreementQueue, type QueueFilter } from "@/lib/eval/review";
import { relativeDay } from "@/lib/progress/summary";
import { OverrideAction, ReviewActions } from "./review-button";

export const dynamic = "force-dynamic";

const FILTERS: Array<{ value: QueueFilter; label: string }> = [
  { value: "open", label: "Open" },
  { value: "disputed", label: "Band disputed" },
  { value: "problem_flagged", label: "Problem flagged" },
  { value: "upheld", label: "Upheld" },
  { value: "all", label: "All" },
];

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
  const slug = one(params, "slug");

  const queue = await disagreementQueue({
    disposition,
    slug: slug || undefined,
  });

  return (
    <main className="px-4 py-4">
      <h1 className="mb-1">Disagreements</h1>
      <p className="mb-4 max-w-2xl text-text-dim">
        Two panelists landed more than one band apart on these answers. The learner
        was given the lower of the two. Decide whether that was right.
      </p>

      <form className="mb-4 flex flex-wrap items-end gap-3" method="get">
        <label className="flex flex-col">
          <span className="text-text-dim">Show</span>
          <select name="show" defaultValue={disposition}
                  className="rounded border border-border bg-bg px-2 py-1">
            {FILTERS.map((filter) => (
              <option key={filter.value} value={filter.value}>{filter.label}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col">
          <span className="text-text-dim">Problem</span>
          <input name="slug" defaultValue={slug} placeholder="slug"
                 className="rounded border border-border bg-bg px-2 py-1" />
        </label>
        <button type="submit" className="rounded border border-border px-3 py-1
                                         hover:border-accent">Filter</button>
      </form>

      <p className="tnum mb-2 text-text-dim">
        {queue.rows.length} shown, {queue.open} still to review
      </p>

      {queue.rows.length === 0 ? (
        <p className="rounded border border-border px-3 py-4 text-text-dim">
          {disposition === "open"
            ? "Nothing to review. Every disagreement the panel recorded has been read."
            : "No rows under this filter. Switch Show to Open to work the queue."}
        </p>
      ) : (
        <table className="w-full text-left">
          <thead>
            <tr className="text-text-dim">
              {["When", "Learner", "Problem", "Level", "The argument",
                "Given", "Score", "Decided"].map((head) => (
                <th key={head} scope="col" className="py-1 pr-4 font-normal">{head}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {queue.rows.map((row) => (
              <tr key={row.evaluationId} className="border-t border-border align-top">
                <td className="py-2 pr-4 text-text-dim">{relativeDay(row.createdAt)}</td>
                <td className="py-2 pr-4">{row.login}</td>
                <td className="py-2 pr-4">
                  <Link href={`/admin/submissions?slug=${row.slug}`}
                        className="hover:text-accent">{row.title}</Link>
                </td>
                <td className="tnum py-2 pr-4 text-text-dim">{row.complexity}</td>
                <td className="py-2 pr-4">
                  {/* Who said what is the row's reason for existing. A reviewer
                      seeing only "weak against strong" cannot tell the judge
                      being overruled from the judge overruling. */}
                  {Object.entries(row.byPanelist).map(([panelist, band]) => (
                    <div key={panelist} className="text-text-dim">
                      {panelist} said <span className="text-text">{band}</span>
                    </div>
                  ))}
                </td>
                <td className="py-2 pr-4 text-warn">{row.held}</td>
                <td className="tnum py-2 pr-4">{row.score ?? "-"}</td>
                <td className="py-2 pr-4">
                  {row.review ? (
                    <div>
                      <div>{row.review.disposition}</div>
                      <div className="mb-1 text-text-faint">
                        {row.review.reviewer}: {row.review.note}
                      </div>
                      {/* A grade somebody has already called wrong is the one
                          worth offering to fix, so the action appears here
                          rather than beside every unread row. */}
                      {row.review.disposition === "disputed" && (
                        <OverrideAction evaluationId={row.evaluationId} held={row.held} />
                      )}
                    </div>
                  ) : (
                    <ReviewActions evaluationId={row.evaluationId} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
