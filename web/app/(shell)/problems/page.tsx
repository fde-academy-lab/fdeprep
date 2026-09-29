/** Screen S3, the problems catalogue. The full pool, visible to everyone. */
import Link from "next/link";
import { facets, listProblems, type CatalogueRow, type Sort } from "@/lib/problems/catalogue";
import { currentLearner } from "@/lib/session/current";
import { DIFFICULTIES, ARTEFACT_TYPES } from "@/lib/problems/vocabulary";

export const dynamic = "force-dynamic";

const STATUSES = ["all", "untouched", "attempted", "solved"] as const;
const SORT_LABELS: Record<Sort, string> = {
  roadmap: "Roadmap",
  difficulty: "Difficulty",
  recent: "Recently added",
  least_attempted: "Least attempted by you",
};

const GLYPH: Record<CatalogueRow["state"], { mark: string; label: string; tone: string }> = {
  solved:    { mark: "ok", label: "Solved",    tone: "text-pass" },
  attempted: { mark: "..", label: "Attempted", tone: "text-warn" },
  untouched: { mark: "--", label: "Untouched", tone: "text-text-faint" },
};

type Params = Record<string, string | string[] | undefined>;

function one(params: Params, key: string, fallback = "all"): string {
  const value = params[key];
  return (Array.isArray(value) ? value[0] : value) ?? fallback;
}

export default async function ProblemsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const learner = await currentLearner();
  const { tracks } = await facets();

  const filters = {
    search: one(params, "q", ""),
    track: one(params, "track"),
    difficulty: one(params, "difficulty"),
    artefactType: one(params, "type"),
    status: one(params, "status") as "all",
    sort: one(params, "sort", "roadmap") as Sort,
    page: Number(one(params, "page", "1")) || 1,
  };
  const page = await listProblems({ ...filters, enrolmentId: learner.enrolmentId });

  // typedRoutes is on, so a hand-built query string is not a valid href. The
  // object form keeps the route checked and the query free-form.
  const link = (patch: Record<string, string>) => {
    const merged: Record<string, string> = {
      q: filters.search, track: filters.track, difficulty: filters.difficulty,
      type: filters.artefactType, status: filters.status, sort: filters.sort, ...patch,
    };
    const query: Record<string, string> = {};
    for (const [key, value] of Object.entries(merged)) {
      if (value && value !== "all") query[key] = value;
    }
    return { pathname: "/problems" as const, query };
  };

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <h1 className="text-xl font-semibold">Problems</h1>

      <form method="get" className="mt-4">
        <input
          type="search" name="q" defaultValue={filters.search}
          placeholder="search problems or tags"
          aria-label="Search problems or tags"
          className="w-full rounded border border-border bg-surface px-3 py-2 text-text
                     placeholder:text-text-faint"
        />
        {filters.sort !== "roadmap" && <input type="hidden" name="sort" value={filters.sort} />}
      </form>

      <div className="mt-4 space-y-2 border-y border-border py-4">
        <FilterGroup label="TRACK"      current={filters.track}         options={["all", ...tracks]}       link={(v) => link({ track: v, page: "1" })} />
        <FilterGroup label="DIFFICULTY" current={filters.difficulty}    options={["all", ...DIFFICULTIES]} link={(v) => link({ difficulty: v, page: "1" })} />
        <FilterGroup label="TYPE"       current={filters.artefactType}  options={["all", ...ARTEFACT_TYPES]} link={(v) => link({ type: v, page: "1" })} />
        <FilterGroup label="STATUS"     current={filters.status}        options={[...STATUSES]}            link={(v) => link({ status: v, page: "1" })} />
      </div>

      <div className="flex items-baseline justify-between py-3 text-text-dim">
        <span>Showing {page.total} problem{page.total === 1 ? "" : "s"}</span>
        <span className="flex items-center gap-2">
          Sort:
          {(Object.keys(SORT_LABELS) as Sort[]).map((sort) => (
            <Link key={sort} href={link({ sort, page: "1" })}
                  className={sort === filters.sort ? "text-accent" : "hover:text-text"}>
              {SORT_LABELS[sort]}
            </Link>
          ))}
        </span>
      </div>

      {page.rows.length === 0 ? (
        <p className="border border-border bg-surface p-8 text-center text-text-dim">
          No problem matches these filters. Clear a filter, or{" "}
          <Link href="/problems" className="text-accent">show every problem</Link>.
        </p>
      ) : (
        <table className="w-full border-collapse text-left">
          <thead className="text-xs uppercase tracking-wide text-text-faint">
            <tr className="border-b border-border">
              <th scope="col" className="w-10 py-2">ST</th>
              <th scope="col" className="py-2">Title</th>
              <th scope="col" className="py-2">Diff</th>
              <th scope="col" className="py-2">Track</th>
              <th scope="col" className="py-2 text-right">Solve</th>
              <th scope="col" className="py-2 text-right">Est</th>
            </tr>
          </thead>
          <tbody>
            {page.rows.map((row) => {
              const glyph = GLYPH[row.state];
              return (
                <tr key={row.id} className="border-b border-border hover:bg-surface">
                  <td className={`py-2 font-mono ${glyph.tone}`}>
                    <span title={glyph.label}>{glyph.mark}</span>
                    <span className="sr-only">{glyph.label}</span>
                  </td>
                  <td className="py-2">
                    <Link href={`/problems/${row.slug}`} className="hover:text-accent">
                      {row.title}
                    </Link>
                  </td>
                  <td className="py-2 capitalize text-text-dim">{row.difficulty}</td>
                  <td className="py-2 text-text-dim">{row.track}</td>
                  <td className="py-2 text-right text-text-dim">
                    {row.solveRate === null ? "hidden" : `${row.solveRate}%`}
                  </td>
                  <td className="py-2 text-right text-text-dim">{row.estMinutes}m</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {page.pages > 1 && (
        <nav className="flex items-center justify-between py-4 text-text-dim">
          <Link href={link({ page: String(Math.max(1, page.page - 1)) })}
                aria-disabled={page.page === 1}
                className={page.page === 1 ? "text-text-faint" : "hover:text-text"}>
            &lt; Previous
          </Link>
          <span>page {page.page} of {page.pages}</span>
          <Link href={link({ page: String(Math.min(page.pages, page.page + 1)) })}
                aria-disabled={page.page === page.pages}
                className={page.page === page.pages ? "text-text-faint" : "hover:text-text"}>
            Next &gt;
          </Link>
        </nav>
      )}
    </main>
  );
}

function FilterGroup({ label, current, options, link }: {
  label: string; current: string; options: readonly string[];
  link: (value: string) => { pathname: "/problems"; query: Record<string, string> };
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <span className="w-24 shrink-0 text-xs uppercase tracking-wide text-text-faint">{label}</span>
      {options.map((option) => (
        <Link key={option} href={link(option)}
              aria-current={option === current ? "true" : undefined}
              className={`rounded border px-2 py-0.5 capitalize ${
                option === current
                  ? "border-accent text-accent"
                  : "border-border text-text-dim hover:text-text"}`}>
          {option === "all" ? "All" : option.replace(/-/g, " ")}
        </Link>
      ))}
    </div>
  );
}
