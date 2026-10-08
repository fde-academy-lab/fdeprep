/**
 * Screen S3, the problems catalogue. The full pool, visible to everyone.
 *
 * Unfiltered, it opens on the chapter map: the fourteen chapters by stage,
 * each with its tiers and how much of it is solved, which is the map Home
 * used to carry. Below it, a list in the manner of an issue tracker: one row
 * per problem, the title first, the question it answers under it, and the
 * metadata a learner filters by. A learner who filters, searches or sorts
 * sees rows first and no map.
 */
import Link from "next/link";
import type { Metadata, Route } from "next";
import { ChevronDown, Search, SearchX } from "lucide-react";
import { facets, listProblems, type CatalogueRow, type Sort } from "@/lib/problems/catalogue";
import { teasers } from "@/lib/problems/workspace";
import { journey, type Journey, type TierCount } from "@/lib/progress/journey";
import { currentLearner } from "@/lib/session/current";
import { ARTEFACT_TYPES, DIFFICULTIES, STAGES } from "@/lib/problems/vocabulary";
import { difficultyLabel, type Difficulty } from "@/lib/policy/tiers";
import { DifficultyMeter } from "@/components/ui/difficulty";
import { EmptyState } from "@/components/ui/empty-state";
import { ButtonLink } from "@/components/ui/button";
import { Page, PageHeading } from "@/components/ui/page";
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
  // The map is the way in, so it shows only on the unfiltered first page.
  const map = !filtered && filters.sort === "roadmap" && page.page === 1
    ? await journey(learner.enrolmentId) : null;

  return (
    <Page>
      <PageHeading title="Problems"
                   line="Every problem is open to everyone. Your path decides the order, not what you may try." />

      {map ? <ChapterMap journey={map} /> : null}

      <div>
        <nav aria-label="Stage" className="flex flex-wrap gap-1.5">
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
                   placeholder="Search titles, questions and chapters" aria-label="Search problems"
                   className="h-8 w-full rounded-control border border-border-control bg-bg pl-8 pr-3
                              text-text outline-none placeholder:text-text-faint focus:border-accent" />
            {filters.stage !== "all" ? <input type="hidden" name="stage" value={filters.stage} /> : null}
            {filters.track !== "all" ? <input type="hidden" name="track" value={filters.track} /> : null}
            {filters.sort !== "roadmap" ? <input type="hidden" name="sort" value={filters.sort} /> : null}
          </form>
          <Menu label={filters.track === "all" ? "Chapter" : trackName(filters.track)} active={filters.track !== "all"}
                options={[{ label: "Any chapter", href: link({ track: "all", page: "1" }), on: filters.track === "all" },
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
            No problem matches these filters. Clear one, or search for a chapter name.
          </EmptyState>
        ) : (
          <ul className="mt-3 divide-y divide-border overflow-hidden rounded-panel border border-border">
            {page.rows.map((row) => (
              <Row key={row.id} row={row} line={lines.get(row.slug)?.situation}
                   dayFirst={filters.sort === "storyline"} />
            ))}
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
      </div>
    </Page>
  );
}

type TierState = "done" | "partial" | "started" | "open" | "none";

function tierState(tier: TierCount): TierState {
  if (tier.total === 0) return "none";
  if (tier.solved === tier.total) return "done";
  if (tier.solved > 0) return "partial";
  if (tier.attempted > 0) return "started";
  return "open";
}

const TIER_LOOK: Record<TierState, string> = {
  done: "bg-text border-text",
  partial: "bg-text-dim/60 border-text-dim",
  started: "border-warn",
  open: "border-border-control",
  none: "border-dashed border-border",
};

/** The fourteen chapters by stage, each a row in the chapter page's style. */
function ChapterMap({ journey: path }: { journey: Journey }) {
  return (
    <div className="space-y-8">
      {path.stages.map((stage) => (
        <section key={stage.id} aria-labelledby={`stage-${stage.id}`}>
          <h2 id={`stage-${stage.id}`} className="text-lead font-semibold text-text">{stage.name}</h2>
          <p className="mt-0.5 text-meta text-text-dim">{stage.blurb}</p>
          <ul className="mt-3 divide-y divide-border overflow-hidden rounded-panel border border-border">
            {stage.tracks.map((track) => (
              <li key={track.track}>
                <Link href={`/chapters/${track.track}` as Route}
                      className="group flex items-center gap-3.5 bg-surface px-4 py-3 hover:bg-surface-2">
                  <TrackIcon track={track.track} className="text-text-dim" />
                  <span className="min-w-0 grow font-medium text-text group-hover:text-accent">{track.name}</span>
                  {/* The count beside it says the same to a screen reader. */}
                  <span aria-hidden className="flex shrink-0 gap-1">
                    {track.tiers.map((tier) => (
                      <span key={tier.difficulty}
                            title={`${difficultyLabel(tier.difficulty)}: ${tier.solved} of ${tier.total} solved`}
                            className={cn("size-2.5 rounded-[3px] border", TIER_LOOK[tierState(tier)])} />
                    ))}
                  </span>
                  {track.total ? (
                    <span className="tnum w-28 shrink-0 text-right text-meta text-text-dim">
                      {track.solved} of {track.total} solved
                    </span>
                  ) : (
                    <span className="w-28 shrink-0 text-right text-meta text-text-faint">No problems yet</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Row({ row, line, dayFirst }: {
  row: CatalogueRow; line: string | undefined;
  /** Under the 30 days sort the day leads the title; under any other it is a fact in the meta row. */
  dayFirst: boolean;
}) {
  const status = row.state === "solved" ? "pass" : row.state;
  return (
    <li>
      <Link href={`/problems/${row.slug}` as Route}
            className="group flex items-start gap-3.5 bg-surface px-4 py-3.5 hover:bg-surface-2">
        <StatusIcon kind={status} className="mt-0.5"
                    label={row.state === "solved" ? "Solved" : row.state === "attempted" ? "Attempted" : "Not started"} />
        <div className="min-w-0 grow">
          <p className="font-semibold text-text group-hover:text-accent">
            {dayFirst && row.day ? (
              <span className="tnum mr-2 text-meta font-medium text-text-faint">Day {row.day}</span>
            ) : null}
            {row.title}
          </p>
          {/* The title names the task, so the line under it asks the question
              the task answers, which says what it teaches before it starts. */}
          {row.question ?? row.headline ?? row.skill ?? line
            ? <p className="mt-0.5 line-clamp-1 text-meta text-text-dim">{renderCode((row.question ?? row.headline ?? row.skill ?? line)!)}</p>
            : null}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-meta">
            {!dayFirst && row.day ? <span className="tnum text-text-faint">Day {row.day}</span> : null}
            <DifficultyMeter difficulty={row.difficulty} />
            <TrackLabel track={row.track} topic={row.topic} />
            <span className="text-text-faint">{TYPE_LABEL[row.artefactType] ?? row.artefactType}</span>
            <span className="text-text-faint">About {row.estMinutes} min</span>
          </div>
        </div>
        {/* The tier decides whether a solve rate shows (lib/problems/catalogue.ts), and a
            row nobody has tried has none to show. Either way the column stays empty. */}
        {row.solveRate !== null ? (
          <span className="tnum hidden shrink-0 text-right text-meta text-text-dim sm:block">
            {row.solveRate}% solve
          </span>
        ) : null}
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
