/**
 * Screen S3, the problems catalogue. The full pool, visible to everyone.
 *
 * A list in the manner of an issue tracker: one row per problem, the title
 * first, the situation under it, and the metadata a learner filters by. Stage
 * sits above the filters because it is the first question a learner asks
 * ("what should someone at my point be doing"), and the tracks inside a stage
 * are the second.
 */
import Link from "next/link";
import type { Metadata, Route } from "next";
import { ChevronDown, Search, SearchX } from "lucide-react";
import { facets, listProblems, type CatalogueRow, type Sort } from "@/lib/problems/catalogue";
import { teasers } from "@/lib/problems/workspace";
import { currentLearner } from "@/lib/session/current";
import { ARTEFACT_TYPES, DIFFICULTIES, STAGES } from "@/lib/problems/vocabulary";
import { difficultyLabel, type Difficulty } from "@/lib/policy/tiers";
import { DifficultyMeter } from "@/components/ui/difficulty";
import { EmptyState } from "@/components/ui/empty-state";
import { ButtonLink } from "@/components/ui/button";
import { StatusIcon } from "@/components/ui/status";
import { TrackIcon, TrackLabel, trackName } from "@/components/ui/tracks";
import { cn } from "@/components/ui/cn";
import { renderCode } from "@/components/ui/code";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Problems" };

const STATUSES = ["all", "untouched", "attempted", "solved"] as const;
const STATUS_LABEL: Record<(typeof STATUSES)[number], string> = {
  all: "Any status", untouched: "Not started", attempted: "Attempted", solved: "Solved",
};
const TYPE_LABEL: Record<string, string> = {
  code: "Code", prompt: "Prompt surgery", design: "Written argument",
};
const SORT_LABELS: Record<Sort, string> = {
  roadmap: "Path order",
  storyline: "The 30 days",
  difficulty: "Difficulty",
  recent: "Newest",
  least_attempted: "Least tried by you",
};

type Params = Record<string, string | string[] | undefined>;
type Href = { pathname: Route; query: Record<string, string> };

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
    stage: one(params, "stage"),
    track: one(params, "track"),
    difficulty: one(params, "difficulty"),
    artefactType: one(params, "type"),
    status: one(params, "status") as "all",
    sort: one(params, "sort", "roadmap") as Sort,
    page: Number(one(params, "page", "1")) || 1,
  };
  const stage = STAGES.find((s) => s.id === filters.stage);
  const page = await listProblems({
    ...filters, tracks: stage && filters.track === "all" ? stage.tracks : undefined,
    enrolmentId: learner.enrolmentId,
  });
  const lines = await teasers(page.rows.map((row) => row.slug));

  // typedRoutes is on, so a hand-built query string is not a valid href. The
  // object form keeps the route checked and the query free-form.
  const link = (patch: Record<string, string>): Href => {
    const merged: Record<string, string> = {
      q: filters.search, stage: filters.stage, track: filters.track,
      difficulty: filters.difficulty, type: filters.artefactType, status: filters.status,
      sort: filters.sort, ...patch,
    };
    const query: Record<string, string> = {};
    for (const [key, value] of Object.entries(merged)) {
      if (value && value !== "all" && !(key === "sort" && value === "roadmap") &&
          !(key === "page" && value === "1")) query[key] = value;
    }
    return { pathname: "/problems", query };
  };

  const visibleTracks = stage ? tracks.filter((t) => (stage.tracks as readonly string[]).includes(t)) : tracks;
  const filtered = filters.search || filters.track !== "all" || filters.difficulty !== "all" ||
    filters.artefactType !== "all" || filters.status !== "all" || filters.stage !== "all";

  return (
    <main className="mx-auto max-w-[1280px] px-4 pb-16 pt-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-display font-semibold tracking-[-0.02em] text-text">Problems</h1>
          <p className="mt-1 text-text-dim">
            Every problem is open to everyone. Your path decides the order, not what you may try.
          </p>
        </div>
      </div>

      <nav aria-label="Stage" className="mt-6 flex flex-wrap gap-1.5">
        {[{ id: "all", name: "All stages" }, ...STAGES].map((s) => (
          <Link key={s.id} href={link({ stage: s.id, track: "all", page: "1" })}
                aria-current={filters.stage === s.id ? "page" : undefined}
                className={cn("rounded-full border px-3 py-1 font-medium",
                              filters.stage === s.id
                                ? "border-text bg-text text-bg"
                                : "border-border-strong text-text-dim hover:border-border-control hover:text-text")}>
            {s.name}
          </Link>
        ))}
      </nav>

      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-panel border border-border bg-surface p-2">
        <form method="get" className="relative min-w-[220px] flex-1" role="search">
          <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-text-faint" />
          <input type="search" name="q" defaultValue={filters.search}
                 placeholder="Search titles, skills and tracks" aria-label="Search problems"
                 className="h-8 w-full rounded-control border border-border-control bg-bg pl-8 pr-3
                            text-text outline-none placeholder:text-text-faint focus:border-accent" />
          {filters.stage !== "all" ? <input type="hidden" name="stage" value={filters.stage} /> : null}
          {filters.track !== "all" ? <input type="hidden" name="track" value={filters.track} /> : null}
          {filters.sort !== "roadmap" ? <input type="hidden" name="sort" value={filters.sort} /> : null}
        </form>
        <Menu label={filters.track === "all" ? "Track" : trackName(filters.track)} active={filters.track !== "all"}
              options={[{ label: "Any track", href: link({ track: "all", page: "1" }), on: filters.track === "all" },
                        ...visibleTracks.map((t) => ({
                          label: trackName(t), href: link({ track: t, page: "1" }), on: filters.track === t,
                          icon: <TrackIcon track={t} className="size-3.5" />,
                        }))]} />
        <Menu label={(DIFFICULTIES as readonly string[]).includes(filters.difficulty)
                       ? difficultyLabel(filters.difficulty as Difficulty) : "Difficulty"}
              active={filters.difficulty !== "all"}
              options={[{ label: "Any difficulty", href: link({ difficulty: "all", page: "1" }), on: filters.difficulty === "all" },
                        ...DIFFICULTIES.map((d) => ({
                          label: difficultyLabel(d), href: link({ difficulty: d, page: "1" }), on: filters.difficulty === d,
                          icon: <DifficultyMeter difficulty={d} label={false} />,
                        }))]} />
        <Menu label={filters.artefactType === "all" ? "Type" : TYPE_LABEL[filters.artefactType] ?? filters.artefactType}
              active={filters.artefactType !== "all"}
              options={[{ label: "Any type", href: link({ type: "all", page: "1" }), on: filters.artefactType === "all" },
                        ...ARTEFACT_TYPES.map((t) => ({
                          label: TYPE_LABEL[t] ?? t, href: link({ type: t, page: "1" }), on: filters.artefactType === t,
                        }))]} />
        <Menu label={STATUS_LABEL[filters.status as keyof typeof STATUS_LABEL] ?? "Status"}
              active={filters.status !== "all"}
              options={STATUSES.map((s) => ({
                label: STATUS_LABEL[s], href: link({ status: s, page: "1" }), on: filters.status === s,
              }))} />
        <Menu label={`Sort: ${SORT_LABELS[filters.sort]}`} active={false} align="right"
              options={(Object.keys(SORT_LABELS) as Sort[]).map((sort) => ({
                label: SORT_LABELS[sort], href: link({ sort, page: "1" }), on: filters.sort === sort,
              }))} />
      </div>

      <div className="mt-6 flex items-baseline justify-between gap-3 text-text-dim">
        <p className="tnum">
          {page.total} {page.total === 1 ? "problem" : "problems"}
          {stage ? ` in ${stage.name}` : ""}
        </p>
        {filtered ? (
          <Link href="/problems" className="text-meta hover:text-text">Clear filters</Link>
        ) : null}
      </div>

      {page.rows.length === 0 ? (
        <EmptyState icon={SearchX} className="mt-3"
                    action={<ButtonLink href="/problems" size="sm">Show every problem</ButtonLink>}>
          No problem matches these filters. Clear one, or search for a track name.
        </EmptyState>
      ) : (
        <ul className="mt-3 divide-y divide-border overflow-hidden rounded-panel border border-border">
          {page.rows.map((row) => <Row key={row.id} row={row} line={lines.get(row.slug)?.situation} />)}
        </ul>
      )}

      {page.pages > 1 ? (
        <nav aria-label="Pages" className="mt-4 flex items-center justify-between text-text-dim">
          {page.page > 1 ? (
            <Link href={link({ page: String(page.page - 1) })} className="hover:text-text">Previous</Link>
          ) : <span />}
          <span className="tnum text-meta">Page {page.page} of {page.pages}</span>
          {page.page < page.pages ? (
            <Link href={link({ page: String(page.page + 1) })} className="hover:text-text">Next</Link>
          ) : <span />}
        </nav>
      ) : null}
    </main>
  );
}

function Row({ row, line }: { row: CatalogueRow; line: string | undefined }) {
  const status = row.state === "solved" ? "pass" : row.state;
  return (
    <li>
      <Link href={`/problems/${row.slug}` as Route}
            className="group flex items-start gap-3.5 bg-surface px-4 py-3.5 hover:bg-surface-2">
        <StatusIcon kind={status} className="mt-0.5"
                    label={row.state === "solved" ? "Solved" : row.state === "attempted" ? "Attempted" : "Not started"} />
        <div className="min-w-0 grow">
          <p className="font-semibold text-text group-hover:text-accent">
            {row.day ? <span className="tnum mr-2 text-meta font-medium text-text-faint">Day {row.day}</span> : null}
            {row.title}
          </p>
          {/* The title names the task, so the line under it tells the story the
              task starts from rather than saying the task a second time. */}
          {row.headline ?? row.skill ?? line
            ? <p className="mt-0.5 line-clamp-1 text-meta text-text-dim">{renderCode((row.headline ?? row.skill ?? line)!)}</p>
            : null}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-meta">
            <DifficultyMeter difficulty={row.difficulty} />
            <TrackLabel track={row.track} />
            <span className="text-text-faint">{TYPE_LABEL[row.artefactType] ?? row.artefactType}</span>
            <span className="text-text-faint">About {row.estMinutes} min</span>
          </div>
        </div>
        <div className="hidden shrink-0 text-right text-meta sm:block">
          {!row.solveRateShown ? (
            <span className="text-text-faint" title="Hard and Extreme hide the solve rate">Solve rate hidden</span>
          ) : row.solveRate === null ? (
            <span className="text-text-faint">No attempts yet</span>
          ) : (
            <span className="tnum text-text-dim">{row.solveRate}% solve</span>
          )}
        </div>
      </Link>
    </li>
  );
}

/**
 * A filter menu. A details element, so it opens without JavaScript and every
 * option is a plain link a learner can bookmark.
 */
function Menu({ label, options, active, align = "left" }: {
  label: string;
  active: boolean;
  align?: "left" | "right";
  options: Array<{ label: string; href: Href; on: boolean; icon?: React.ReactNode }>;
}) {
  return (
    <details className="group relative">
      <summary className={cn(
        "flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-control border px-2.5",
        "[&::-webkit-details-marker]:hidden",
        active ? "border-accent/60 text-text" : "border-border-strong text-text-dim hover:text-text")}>
        {label}
        <ChevronDown aria-hidden className="size-3.5 transition-transform group-open:rotate-180" />
      </summary>
      <ul className={cn("absolute z-30 mt-1.5 max-h-80 min-w-52 overflow-y-auto rounded-panel border",
                        "border-border-strong bg-surface p-1 shadow-[0_16px_40px_-12px_rgb(0_0_0/0.55)] rise-in",
                        align === "right" ? "right-0" : "left-0")}>
        {options.map((option) => (
          <li key={option.label}>
            <Link href={option.href}
                  aria-current={option.on ? "true" : undefined}
                  className={cn("flex items-center gap-2 rounded-control px-2.5 py-1.5",
                                option.on ? "bg-surface-3 text-text" : "text-text-dim hover:bg-surface-2 hover:text-text")}>
              {option.icon}
              {option.label}
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}
