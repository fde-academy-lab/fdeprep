/**
 * Screen S2, home: where a learner lands.
 *
 * One primary action at the top, which is always the next thing to open. Below
 * it, the whole path at a glance, then what comes next, the end-to-end builds,
 * and what happened recently. Every ordering decision comes from
 * lib/policy/roadmap; this file draws what it is handed.
 */
import Link from "next/link";
import type { Metadata } from "next";
import { nextUp } from "@/lib/policy/roadmap";
import { heatmap } from "@/lib/progress";
import { recentActivity, topAndBottom } from "@/lib/progress/summary";
import { builds, continueItem, journey } from "@/lib/progress/journey";
import { teasers } from "@/lib/problems/workspace";
import { stageOf } from "@/components/ui/tracks";
import { currentLearner } from "@/lib/session/current";
import {
  ActivityList, BuildsPanel, ContinuePanel, JourneyMap, PressurePanel, ReadinessPanel,
  SectionHeading, UpNext,
} from "@/components/home/sections";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Home" };

export default async function HomePage() {
  const learner = await currentLearner();
  const view = await nextUp(learner.enrolmentId);
  const resume = await continueItem(learner.enrolmentId);
  const grid = await heatmap(learner.enrolmentId);
  const path = await journey(learner.enrolmentId);
  const builds_ = await builds(learner.enrolmentId);
  const recent = await recentActivity(learner.enrolmentId);

  const primary = resume ?? view.items[0] ?? null;
  const kind = resume ? "continue" : view.kind === "start" ? "start" : view.kind === "done" ? "done" : "next";
  // The roadmap's own order, skipping what is solved and what the persona has
  // not opened yet. The start card holds one item, so the list reads the
  // roadmap rather than the three Next Up cards.
  const upNext = view.roadmap.items
    .filter((item) => !item.solved && item.slug !== primary?.slug &&
                      (!item.isOptional || view.roadmap.optionalUnlocked))
    .slice(0, 4);
  const teaserMap = await teasers([primary?.slug, ...upNext.map((i) => i.slug)]
    .filter((s): s is string => Boolean(s)));
  const currentStage = primary ? stageOf(primary.track)?.id ?? null : null;
  const firstName = learner.displayName.split(/\s+/)[0] ?? learner.displayName;

  return (
    <main className="mx-auto max-w-[1280px] space-y-12 px-4 pb-16 pt-8 sm:px-6">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <ContinuePanel firstName={firstName} kind={kind}
                       item={primary ? {
                         slug: primary.slug, title: primary.title, track: primary.track,
                         difficulty: primary.difficulty, runs: resume?.runs,
                       } : null}
                       teaser={primary ? teaserMap.get(primary.slug) ?? null : null} />
        <ReadinessPanel clean={grid.cleanCells} total={grid.totalCells} bars={topAndBottom(grid)} />
      </div>

      <section>
        <SectionHeading title="Your path, zero to forward deployed"
                        action={<span className="tnum text-text-faint">{path.solved} of {path.total} problems solved</span>} />
        <JourneyMap journey={path} currentStage={currentStage} />
      </section>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <section>
          <SectionHeading title="Up next"
                          action={<Link href="/problems" className="text-text-dim hover:text-text">Problems</Link>} />
          <UpNext items={upNext} teasers={teaserMap} />
        </section>
        <section>
          <SectionHeading title={builds_.length ? "End-to-end builds" : "Practise under pressure"} />
          {builds_.length ? <BuildsPanel builds={builds_} /> : <PressurePanel />}
        </section>
      </div>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <section>
          <SectionHeading title="Recent activity"
                          action={<Link href="/progress" className="text-text-dim hover:text-text">Full history</Link>} />
          <ActivityList rows={recent} />
        </section>
        {builds_.length ? (
          <section>
            <SectionHeading title="Practise under pressure" />
            <PressurePanel />
          </section>
        ) : null}
      </div>
    </main>
  );
}
