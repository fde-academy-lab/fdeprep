/**
 * One chapter: what it teaches, its topics in order, and every problem under
 * the topic it belongs to, Easy to Extreme, each with the question it answers.
 *
 * The catalogue answers "what can I try"; this page answers "what does this
 * chapter teach and where am I in it". It reads the same rows as the
 * catalogue, so a problem's state and order never disagree between the two.
 */
import Link from "next/link";
import type { Metadata, Route } from "next";
import { notFound } from "next/navigation";
import { ArrowRight, PenLine } from "lucide-react";
import {
  facets, listProblems, nearestWithProblems, nextOnPath, type CatalogueRow,
} from "@/lib/problems/catalogue";
import { currentLearner } from "@/lib/session/current";
import { CHAPTER_TOPICS, DIFFICULTIES, STAGES, TRACK_BLURBS, TRACK_NAMES, TRACKS, type Track }
  from "@/lib/problems/vocabulary";
import { ButtonLink } from "@/components/ui/button";
import { DifficultyMeter } from "@/components/ui/difficulty";
import { EmptyState } from "@/components/ui/empty-state";
import { Page } from "@/components/ui/page";
import { StatusIcon } from "@/components/ui/status";
import { TrackIcon } from "@/components/ui/tracks";
import { renderCode } from "@/components/ui/code";

export const dynamic = "force-dynamic";

function chapterOf(value: string): Track | null {
  return (TRACKS as readonly string[]).includes(value) ? (value as Track) : null;
}

export async function generateMetadata(
  { params }: { params: Promise<{ chapter: string }> },
): Promise<Metadata> {
  const chapter = chapterOf((await params).chapter);
  return { title: chapter ? TRACK_NAMES[chapter] : "Chapter" };
}

export default async function ChapterPage({ params }: { params: Promise<{ chapter: string }> }) {
  const chapter = chapterOf((await params).chapter);
  if (!chapter) notFound();
  const learner = await currentLearner();
  const { rows } = await listProblems({
    enrolmentId: learner.enrolmentId, track: chapter, perPage: 100, sort: "difficulty",
  });
  const stage = STAGES.find((s) => (s.tracks as readonly string[]).includes(chapter));
  // Tier first, then the day the path gives it, so the page reads in the
  // order a learner meets the problems.
  const order = (a: CatalogueRow, b: CatalogueRow) =>
    DIFFICULTIES.indexOf(a.difficulty as never) - DIFFICULTIES.indexOf(b.difficulty as never) ||
    (a.day ?? 99) - (b.day ?? 99) || a.slug.localeCompare(b.slug);
  const topics = CHAPTER_TOPICS[chapter].map((topic) => ({
    topic,
    rows: rows.filter((row) => row.topic === topic).sort(order),
  }));
  const loose = rows.filter((row) => !row.topic || !CHAPTER_TOPICS[chapter].includes(row.topic));
  const solved = rows.filter((row) => row.state === "solved").length;
  // The learner's path picks what comes next; the page's order is the
  // fallback for a chapter with nothing on the path.
  const next = nextOnPath([...rows].sort(order));
  const nearest = rows.length ? null : nearestWithProblems(chapter, (await facets()).tracks);

  const groups = [...topics, ...(loose.length ? [{ topic: "Other", rows: loose }] : [])]
    .filter((group) => group.rows.length);

  return (
    <Page>
      <div>
        <p className="text-meta font-medium text-text-faint">
          {stage ? `${stage.name} stage` : "Chapter"}
        </p>
        <h1 className="mt-1 flex items-center gap-2.5 text-display font-semibold tracking-[-0.02em] text-text">
          <TrackIcon track={chapter} className="size-6 text-text-dim" />
          {TRACK_NAMES[chapter]}
        </h1>
        <p className="mt-2 max-w-[70ch] text-text-dim">{TRACK_BLURBS[chapter]}</p>
        <p className="mt-3 text-meta text-text-faint">
          <span className="tnum">{solved}</span> of <span className="tnum">{rows.length}</span> solved
        </p>
        {next ? (
          <Link href={`/problems/${next.slug}` as Route}
                className="mt-5 flex items-center justify-between gap-4 rounded-panel border border-border
                           bg-surface px-4 py-3.5 hover:bg-surface-2">
            <span className="min-w-0">
              <span className="block text-meta text-text-faint">Next in this chapter</span>
              <span className="block font-medium text-text">{next.title}</span>
            </span>
            <ArrowRight aria-hidden className="size-4 shrink-0 text-text-faint" />
          </Link>
        ) : rows.length ? (
          <p className="mt-5 text-text-dim">Every problem in this chapter is solved. The next chapter is on your home page.</p>
        ) : nearest ? (
          <EmptyState icon={PenLine} className="mt-5"
                      action={<ButtonLink href={`/chapters/${nearest}` as Route} size="sm">
                        Open {TRACK_NAMES[nearest]}
                      </ButtonLink>}>
            This chapter&apos;s problems are still being written. The nearest chapter with problems
            is {TRACK_NAMES[nearest]}.
          </EmptyState>
        ) : null}
      </div>

      {groups.length ? (
        <div className="space-y-9">
          {groups.map((group) => (
            <section key={group.topic} aria-labelledby={`topic-${group.topic}`}>
              <h2 id={`topic-${group.topic}`} className="text-lead font-semibold text-text">{group.topic}</h2>
              <ol className="mt-3 divide-y divide-border overflow-hidden rounded-panel border border-border">
                {group.rows.map((row) => (
                  <li key={row.slug}>
                    <Link href={`/problems/${row.slug}` as Route}
                          className="group flex items-start gap-3.5 bg-surface px-4 py-3 hover:bg-surface-2">
                      <StatusIcon kind={row.state === "solved" ? "pass" : row.state} className="mt-0.5"
                                  label={row.state === "solved" ? "Solved"
                                    : row.state === "attempted" ? "Attempted" : "Not started"} />
                      <span className="min-w-0 grow">
                        <span className="block font-medium text-text group-hover:text-accent">{row.title}</span>
                        {row.question ? (
                          <span className="mt-0.5 block text-meta text-text-dim">{renderCode(row.question)}</span>
                        ) : null}
                      </span>
                      {row.day === null ? (
                        <span className="shrink-0 pt-0.5 text-meta text-text-faint">Drill</span>
                      ) : null}
                      <span className="shrink-0 pt-0.5"><DifficultyMeter difficulty={row.difficulty} /></span>
                    </Link>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      ) : null}
    </Page>
  );
}
