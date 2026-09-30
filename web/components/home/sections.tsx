/**
 * The pieces of the home screen. Server components: they draw what the page
 * hands them and decide nothing about tiers or order, which lib/policy owns.
 */
import Link from "next/link";
import type { Route } from "next";
import { ArrowRight, Check, Hammer, Mic, Timer } from "lucide-react";
import type { RoadmapItem } from "@/lib/policy/roadmap";
import type { BuildSummary, ContinueItem, Journey } from "@/lib/progress/journey";
import type { CompetencyBar } from "@/lib/progress/summary";
import type { Teaser } from "@/lib/problems/workspace";
import { ButtonLink } from "@/components/ui/button";
import { DiagramThumbnail } from "@/components/workspace/diagram";
import { DifficultyMeter } from "@/components/ui/difficulty";
import { StatusIcon } from "@/components/ui/status";
import { TrackIcon, TrackLabel } from "@/components/ui/tracks";
import { cn } from "@/components/ui/cn";
import { renderCode } from "@/components/ui/code";

const problemHref = (slug: string) => `/problems/${slug}` as Route;

export function SectionHeading({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-baseline justify-between gap-4">
      <h2 className="text-title font-semibold tracking-[-0.01em] text-text">{title}</h2>
      {action ? <div className="text-meta">{action}</div> : null}
    </div>
  );
}

export function ContinuePanel({ firstName, item, teaser, kind }: {
  firstName: string;
  item: { slug: string; title: string; track: string; difficulty: RoadmapItem["difficulty"];
          runs?: number } | null;
  teaser: Teaser | null;
  kind: "continue" | "start" | "next" | "done";
}) {
  const lead = kind === "continue" ? "Pick up where you left off"
    : kind === "start" ? "Your first problem"
    : kind === "next" ? "Next on your path" : "Your path is complete";
  return (
    <section className="relative overflow-hidden rounded-panel border border-border bg-surface">
      <div aria-hidden className="pointer-events-none absolute inset-0
                                  bg-[radial-gradient(120%_80%_at_0%_0%,rgb(110_151_242/0.08),transparent_60%)]" />
      <div className={cn("relative grid h-full gap-6 p-6 sm:p-7",
                         teaser?.diagram ? "xl:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]" : "")}>
      <div className="flex flex-col gap-5">
        <p className="text-text-dim">
          {kind === "start" ? `Welcome, ${firstName}.` : `Welcome back, ${firstName}.`}{" "}
          <span className="text-text-faint">{lead}.</span>
        </p>
        {item ? (
          <>
            <div>
              <h1 className="max-w-[26ch] text-display font-semibold leading-[1.15] tracking-[-0.02em] text-text">
                {item.title}
              </h1>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-meta">
                <DifficultyMeter difficulty={item.difficulty} />
                <TrackLabel track={item.track} />
                {kind === "continue" && item.runs ? (
                  <span className="text-text-dim">{item.runs} {item.runs === 1 ? "run" : "runs"} so far</span>
                ) : null}
              </div>
            </div>
            {teaser ? (
              <p className="max-w-[62ch] text-lead leading-relaxed text-text-dim">
                <span className="text-text">{renderCode(teaser.who)}.</span> {renderCode(teaser.situation)}
              </p>
            ) : null}
            <div className="mt-auto flex flex-wrap gap-2.5">
              <ButtonLink href={problemHref(item.slug)} variant="primary" size="lg">
                {kind === "continue" ? "Continue" : "Open the problem"} <ArrowRight aria-hidden />
              </ButtonLink>
              <ButtonLink href="/problems" variant="ghost" size="lg">Browse all problems</ButtonLink>
            </div>
          </>
        ) : (
          <>
            <h1 className="text-display font-semibold tracking-[-0.02em] text-text">
              Every problem on your path is solved.
            </h1>
            <div className="flex flex-wrap gap-2.5">
              <ButtonLink href="/rehearsal" variant="primary" size="lg">Sit a rehearsal <ArrowRight aria-hidden /></ButtonLink>
              <ButtonLink href="/problems" variant="ghost" size="lg">Browse all problems</ButtonLink>
            </div>
          </>
        )}
      </div>
      {teaser?.diagram ? (
        <div aria-hidden className="pointer-events-none hidden select-none self-center opacity-90 xl:block">
          <DiagramThumbnail diagram={teaser.diagram} />
        </div>
      ) : null}
      </div>
    </section>
  );
}

/** A half-ring gauge. docs/02 section 7: readiness counts clean cells only. */
export function ReadinessPanel({ clean, total, bars }: {
  clean: number; total: number; bars: CompetencyBar[];
}) {
  const share = total ? clean / total : 0;
  const r = 70;
  const arc = Math.PI * r;
  return (
    <section className="flex flex-col rounded-panel border border-border bg-surface p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="font-semibold text-text">Readiness</h2>
        <Link href="/progress" className="text-meta text-text-dim hover:text-text">Full heatmap</Link>
      </div>
      <div className="relative mx-auto mt-3 h-[92px] w-[172px]">
        <svg viewBox="0 0 172 92" className="size-full" aria-hidden>
          <path d="M 16 86 A 70 70 0 0 1 156 86" fill="none" className="stroke-border-strong"
                strokeWidth="10" strokeLinecap="round" />
          <path d="M 16 86 A 70 70 0 0 1 156 86" fill="none" className="stroke-accent"
                strokeWidth="10" strokeLinecap="round"
                strokeDasharray={`${Math.max(0.001, share * arc)} ${arc}`} />
        </svg>
        <p className="absolute inset-x-0 bottom-0 text-center">
          <span className="tnum text-display font-semibold tracking-tight text-text">{clean}</span>
          <span className="tnum text-text-dim"> / {total}</span>
        </p>
      </div>
      <p className="mt-2 text-center text-meta leading-relaxed text-text-dim">
        Clean passes across 13 competencies and four tiers. This is the number placement reads.
      </p>
      {bars.length ? (
        <ul className="mt-5 space-y-2.5 border-t border-border pt-4">
          {bars.map((bar) => (
            <li key={bar.slug}>
              <div className="flex items-baseline justify-between gap-3 text-meta">
                <span className="truncate text-text">{bar.name.charAt(0).toUpperCase() + bar.name.slice(1)}</span>
                <span className="shrink-0 text-text-faint">{bar.label}</span>
              </div>
              <div aria-hidden className="mt-1.5 flex h-1 gap-0.5">
                {Array.from({ length: 10 }, (_, i) => (
                  <span key={i} className={cn("flex-1 rounded-full",
                    i < bar.filled ? "bg-text-dim" : "bg-border-strong")} />
                ))}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-5 border-t border-border pt-4 text-meta text-text-dim">
          Pass a problem and the competencies it trains start filling in here.
        </p>
      )}
    </section>
  );
}

type TierState = "done" | "partial" | "started" | "open" | "none";

function tierState(t: Journey["stages"][number]["tracks"][number]["tiers"][number]): TierState {
  if (t.total === 0) return "none";
  if (t.solved === t.total) return "done";
  if (t.solved > 0) return "partial";
  if (t.attempted > 0) return "started";
  return "open";
}

const TIER_LOOK: Record<TierState, string> = {
  done: "bg-text border-text",
  partial: "bg-text-dim/60 border-text-dim",
  started: "border-warn",
  open: "border-border-control",
  none: "border-dashed border-border",
};

export function JourneyMap({ journey, currentStage }: { journey: Journey; currentStage: string | null }) {
  return (
    <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {journey.stages.map((stage, index) => {
        const current = stage.id === currentStage;
        const done = stage.total > 0 && stage.solved === stage.total;
        return (
          <li key={stage.id}
              className={cn("relative flex flex-col rounded-panel border bg-surface",
                            current ? "border-accent/60" : "border-border")}>
            <div className="border-b border-border px-4 pb-3 pt-3.5">
              <div className="flex items-center justify-between gap-3">
                <p className="flex items-center gap-2 font-semibold text-text">
                  <span className={cn("grid size-6 place-items-center rounded-full border font-mono text-meta",
                                      done ? "border-pass/50 text-pass"
                                        : current ? "border-accent text-accent" : "border-border-strong text-text-faint")}>
                    {done ? <Check aria-hidden className="size-3.5" /> : index + 1}
                  </span>
                  {stage.name}
                </p>
                <span className="tnum text-meta text-text-faint">{stage.solved}/{stage.total}</span>
              </div>
              <p className="mt-1.5 text-meta leading-snug text-text-dim">{stage.blurb}</p>
              {current ? <p className="mt-2 text-meta font-medium text-accent">You are here</p> : null}
            </div>
            <ul className="flex-1 divide-y divide-border">
              {stage.tracks.map((track) => (
                <li key={track.track}>
                  <Link href={{ pathname: "/problems" as Route, query: { track: track.track } }}
                        className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2">
                    <TrackIcon track={track.track} className="text-text-dim" />
                    <span className="min-w-0 grow leading-snug text-text">{track.name}</span>
                    <span aria-label="Progress by difficulty" className="flex shrink-0 gap-1">
                      {track.tiers.map((tier) => (
                        <span key={tier.difficulty}
                              title={`${tier.difficulty}: ${tier.solved} of ${tier.total} solved`}
                              className={cn("size-2.5 rounded-[3px] border", TIER_LOOK[tierState(tier)])} />
                      ))}
                    </span>
                    <span className="tnum w-9 shrink-0 text-right text-meta text-text-faint">
                      {track.solved}/{track.total}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </li>
        );
      })}
    </ol>
  );
}

export function UpNext({ items, teasers }: { items: RoadmapItem[]; teasers: Map<string, Teaser> }) {
  if (!items.length) {
    return <p className="text-text-dim">Nothing left on your path. The full catalogue is one click away.</p>;
  }
  return (
    <ol className="divide-y divide-border overflow-hidden rounded-panel border border-border">
      {items.map((item) => {
        const teaser = teasers.get(item.slug);
        return (
          <li key={item.slug}>
            <Link href={problemHref(item.slug)}
                  className="group flex items-start gap-4 bg-surface px-4 py-3.5 hover:bg-surface-2">
              <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-control border
                               border-border bg-surface-2 text-text-dim">
                <TrackIcon track={item.track} />
              </span>
              <span className="min-w-0 grow">
                <span className="block font-medium text-text">{item.title}</span>
                {teaser ? (
                  <span className="mt-0.5 line-clamp-1 block text-meta text-text-dim">{renderCode(teaser.situation)}</span>
                ) : null}
                <span className="mt-1.5 flex flex-wrap items-center gap-x-3 text-meta">
                  <DifficultyMeter difficulty={item.difficulty} />
                  <span className="text-text-faint">About {item.estMinutes} min</span>
                </span>
              </span>
              <ArrowRight aria-hidden className="mt-1 size-4 shrink-0 text-text-faint
                                                  group-hover:text-text" />
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

export function BuildsPanel({ builds }: { builds: BuildSummary[] }) {
  return (
    <ul className="space-y-3">
      {builds.map((build) => {
        const next = build.stages.find((s) => !s.solved) ?? null;
        const solved = build.stages.filter((s) => s.solved).length;
        return (
          <li key={build.id} className="rounded-panel border border-border bg-surface p-4">
            <div className="flex items-start gap-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-control border border-border
                               bg-surface-2 text-text-dim">
                <Hammer aria-hidden className="size-4" strokeWidth={1.75} />
              </span>
              <div className="min-w-0 grow">
                <p className="font-medium text-text">{renderCode(build.title)}</p>
                <p className="text-meta text-text-faint">{solved} of {build.of} stages passed</p>
              </div>
            </div>
            <ol className="mt-3 flex gap-1.5">
              {Array.from({ length: build.of }, (_, i) => {
                const stage = build.stages.find((s) => s.stage === i + 1);
                return (
                  <li key={i} className={cn("h-1.5 flex-1 rounded-full",
                    stage?.solved ? "bg-pass" : stage?.attempted ? "bg-text-dim" : "bg-border-strong")}
                      title={stage ? `Stage ${i + 1}: ${stage.title}` : `Stage ${i + 1}`} />
                );
              })}
            </ol>
            {next ? (
              <Link href={problemHref(next.slug)}
                    className="mt-3 flex items-center justify-between gap-3 rounded-control px-2 py-1.5
                               text-meta text-text-dim hover:bg-surface-2 hover:text-text">
                <span className="truncate">Stage {next.stage}: {next.title}</span>
                <ArrowRight aria-hidden className="size-3.5 shrink-0" />
              </Link>
            ) : (
              <p className="mt-3 text-meta text-pass">Every stage passed.</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function ActivityList({ rows }: {
  rows: Array<{ slug: string; title: string; verdict: string | null; whenLabel: string; submits: number }>;
}) {
  if (!rows.length) {
    return (
      <p className="rounded-panel border border-dashed border-border-strong px-4 py-5 text-text-dim">
        Nothing submitted yet. Your first run shows up here with its result.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-panel border border-border">
      {rows.map((row) => (
        <li key={row.slug}>
          <Link href={problemHref(row.slug)} className="flex items-center gap-3 bg-surface px-4 py-3
                                                       hover:bg-surface-2">
            <StatusIcon kind={row.verdict === "pass" ? "pass" : "fail"} />
            <span className="min-w-0 grow truncate text-text">{row.title}</span>
            <span className="shrink-0 text-meta text-text-faint">
              {row.whenLabel}, {row.submits} {row.submits === 1 ? "submit" : "submits"}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function PressurePanel() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
      <Link href="/rehearsal" className="group rounded-panel border border-border bg-surface p-4 hover:bg-surface-2">
        <p className="flex items-center gap-2 font-medium text-text">
          <Timer aria-hidden className="size-4 text-text-dim" strokeWidth={1.75} /> Sit a rehearsal
        </p>
        <p className="mt-1.5 text-meta leading-relaxed text-text-dim">
          A timed set under screen conditions: no hints, no coach, one submit each. Two a week,
          so the result means something.
        </p>
      </Link>
      <Link href="/voice/session" className="group rounded-panel border border-border bg-surface p-4 hover:bg-surface-2">
        <p className="flex items-center gap-2 font-medium text-text">
          <Mic aria-hidden className="size-4 text-text-dim" strokeWidth={1.75} /> Answer out loud
        </p>
        <p className="mt-1.5 text-meta leading-relaxed text-text-dim">
          Interview questions answered by voice, with a pace band while you speak and a debrief
          after. Nothing is transcribed onto the screen while you talk.
        </p>
      </Link>
    </div>
  );
}
