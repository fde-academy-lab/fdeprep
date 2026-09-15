/**
 * Screen S2, the roadmap, which is where a learner lands.
 *
 * Every ordering decision here comes from lib/policy/roadmap. This file draws
 * what it is handed and holds no view on what a persona or a tier does.
 */
import Link from "next/link";
import Nav from "./nav";
import { nextUp, type RoadmapItem } from "@/lib/policy/roadmap";
import { resolvePolicy } from "@/lib/policy";
import { heatmap } from "@/lib/progress";
import { recentActivity, topAndBottom } from "@/lib/progress/summary";
import { currentLearner } from "@/lib/session/current";

export const dynamic = "force-dynamic";

export default async function RoadmapPage() {
  const learner = await currentLearner();
  const view = await nextUp(learner.enrolmentId);
  const grid = await heatmap(learner.enrolmentId);
  const bars = topAndBottom(grid);
  const recent = await recentActivity(learner.enrolmentId);

  const live = view.roadmap.items.length
    ? await resolvePolicy({
        enrolmentId: learner.enrolmentId,
        problemId: view.roadmap.items[0]!.problemId,
      })
    : null;

  return (
    <main className="mx-auto max-w-5xl">
      <Nav active="roadmap" />

      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b
                         border-border px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-4">
          <span>Your track: <span className="text-text">{view.roadmap.trackName}</span></span>
          <span className="text-text-dim capitalize">Persona: {view.roadmap.persona}</span>
        </div>
        <div className="flex flex-wrap items-baseline gap-4 text-text-dim">
          <span className="tnum">
            {view.roadmap.solved} of {view.roadmap.total} solved
          </span>
          {live ? (
            <span className="tnum">
              Live runs left today: {live.live.max === null ? "unlimited" : live.live.remaining}
            </span>
          ) : null}
        </div>
      </header>

      <section className="border-b border-border px-4 py-4">
        <h2 className="mb-3 text-text-dim">
          {view.kind === "start" ? "START HERE"
            : view.kind === "done" ? "ROADMAP COMPLETE" : "NEXT UP"}
        </h2>

        {view.kind === "done" ? (
          <p className="text-text-dim">
            Every problem on this roadmap is solved.{" "}
            <Link href="/problems" className="text-accent">Open the full catalogue</Link> for the
            rest of the pool.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {view.items.map((item) => <Card key={item.slug} item={item} />)}
          </div>
        )}
      </section>

      <section className="border-b border-border px-4 py-4">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-text-dim">YOUR COMPETENCIES</h2>
          <Link href="/progress" className="text-accent">see full heatmap</Link>
        </div>

        {bars.length ? (
          <ul className="space-y-1">
            {bars.map((bar) => (
              <li key={bar.slug} className="flex items-center gap-3">
                <span className="w-44 shrink-0 truncate">{bar.name}</span>
                <span aria-hidden className="font-mono text-accent">
                  {"#".repeat(bar.filled)}
                  <span className="text-text-faint">{"-".repeat(10 - bar.filled)}</span>
                </span>
                <span className="text-text-dim">{bar.label}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-text-dim">
            No competency has been scored yet. Solve a problem and this fills in.
          </p>
        )}
      </section>

      <section className="px-4 py-4">
        <h2 className="mb-3 text-text-dim">RECENT ACTIVITY</h2>
        {recent.length ? (
          <table className="w-full text-left">
            <tbody>
              {recent.map((row) => (
                <tr key={row.slug} className="border-t border-border">
                  <td className={`py-2 pr-4 ${row.verdict === "pass" ? "text-pass" : "text-warn"}`}>
                    {row.verdict === "pass" ? "passed" : "failed"}
                  </td>
                  <td className="py-2 pr-4">
                    <Link href={`/problems/${row.slug}`} className="hover:text-accent">
                      {row.title}
                    </Link>
                  </td>
                  <td className="py-2 pr-4 text-text-dim">{row.whenLabel}</td>
                  <td className="tnum py-2 text-text-dim">
                    {row.submits} {row.submits === 1 ? "submit" : "submits"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-text-dim">Nothing submitted yet. The first run shows up here.</p>
        )}
      </section>
    </main>
  );
}

function Card({ item }: { item: RoadmapItem }) {
  return (
    <article className="flex flex-col gap-2 rounded border border-border bg-surface p-3">
      <p className="text-text-dim">
        <span className="capitalize">{item.difficulty}</span> | {item.track}
      </p>
      <h3 className="grow">{item.title}</h3>
      <p className="tnum text-text-dim">
        {item.estMinutes}m | {item.competencyCount}{" "}
        {item.competencyCount === 1 ? "competency" : "competencies"}
      </p>
      <Link href={`/problems/${item.slug}`}
            className="rounded border border-border px-2 py-1 text-center hover:border-accent">
        Open
      </Link>
    </article>
  );
}
