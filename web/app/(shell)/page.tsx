/**
 * Screen S2, home: where a learner lands. One position and one next action.
 *
 * The position strip says where the learner stands on their path. The next
 * action is the first problem on it before any attempt, three Next up cards
 * after one, and a rehearsal once every problem on the path is passed. The
 * readiness line is the same object Progress draws, from the same query.
 * Every ordering decision comes from lib/policy/roadmap; this file draws what
 * it is handed.
 */
import type { Metadata } from "next";
import { nextUp } from "@/lib/policy/roadmap";
import { heatmap } from "@/lib/progress";
import { coverageFor } from "@/lib/progress/coverage";
import { continueItem } from "@/lib/progress/journey";
import { readinessFor } from "@/lib/progress/readiness";
import { recentActivity, topAndBottom } from "@/lib/progress/summary";
import { currentLearner } from "@/lib/session/current";
import {
  CompetencyBars, NextUp, PathComplete, PositionStrip, RecentActivity, StartCard,
} from "@/components/home/sections";
import { ReadinessLine } from "@/components/progress/readiness-line";
import { Page } from "@/components/ui/page";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Home" };

export default async function HomePage() {
  const learner = await currentLearner();
  const [view, resume, grid, readiness, coverage, recent] = await Promise.all([
    nextUp(learner.enrolmentId),
    continueItem(learner.enrolmentId),
    heatmap(learner.enrolmentId),
    readinessFor(learner.enrolmentId),
    coverageFor(learner.enrolmentId),
    recentActivity(learner.enrolmentId),
  ]);

  // The problem left unfinished takes the first card, and the path fills the
  // rest. The path carries every problem, so its row has the card's facts.
  const resumed = resume ? view.roadmap.items.find((item) => item.slug === resume.slug) : undefined;
  const cards = [...(resumed ? [resumed] : []),
                 ...view.items.filter((item) => item.slug !== resumed?.slug)].slice(0, 3);
  const bars = topAndBottom(grid);

  return (
    <Page>
      <h1 className="sr-only">Home</h1>
      <PositionStrip roadmap={view.roadmap} />
      {view.kind === "start" ? <StartCard item={view.items[0]!} />
        : view.kind === "done" ? <PathComplete />
        : <NextUp items={cards} resumed={resumed?.slug ?? null} />}
      {view.kind === "next_up" && bars.length ? <CompetencyBars bars={bars} /> : null}
      <ReadinessLine readiness={readiness} coverage={coverage} />
      {view.kind === "start" ? null : <RecentActivity rows={recent} />}
    </Page>
  );
}
