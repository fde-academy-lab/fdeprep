/**
 * The pieces of the home screen, S2. Server components: they draw what the
 * page hands them and decide nothing about tiers or order, which lib/policy
 * owns. One position (the strip) and one next action (the start card, Next
 * up, or a rehearsal once the path is done) per visit.
 */
import Link from "next/link";
import type { Route } from "next";
import { ArrowRight, History } from "lucide-react";
import type { Roadmap, RoadmapItem } from "@/lib/policy/roadmap";
import type { ActivityRow, CompetencyBar } from "@/lib/progress/summary";
import { STORYLINE_DAYS } from "@/lib/problems/vocabulary";
import { ButtonLink } from "@/components/ui/button";
import { DifficultyMeter } from "@/components/ui/difficulty";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeading } from "@/components/ui/page";
import { StatStrip } from "@/components/ui/stat-strip";
import { StatusIcon } from "@/components/ui/status";
import { Cell, Head, NumCell, Row, Table } from "@/components/ui/table";
import { TrackLabel } from "@/components/ui/tracks";
import { cn } from "@/components/ui/cn";

const problemHref = (slug: string) => `/problems/${slug}` as Route;

/**
 * Where the learner stands: the track, the persona, the earliest day on the
 * 30-day storyline with a required problem still unsolved, and how much of
 * the path is solved.
 */
export function PositionStrip({ roadmap }: { roadmap: Roadmap }) {
  const unsolved = roadmap.items.filter((item) => !item.solved && !item.isOptional);
  // The earliest day, not the next problem's, because the path's order and the
  // storyline's can disagree and the day should never step back. A problem
  // published before the storyline has no day, and the strip says nothing
  // rather than guess one.
  const days = unsolved.flatMap((item) => (item.day === null ? [] : [item.day]));
  const day = !unsolved.length ? "Path complete"
    : days.length ? `Day ${Math.min(...days)} of ${STORYLINE_DAYS}` : null;
  const cells = [
    { label: "Track", value: roadmap.trackName },
    { label: "Persona", value: roadmap.persona.charAt(0).toUpperCase() + roadmap.persona.slice(1) },
    ...(day ? [{ label: "Day", value: day }] : []),
    { label: "Solved", value: `${roadmap.solved} of ${roadmap.total}` },
  ];
  // The track's name is the longest value, so its column fits it and the
  // others share what is left.
  return (
    <StatStrip cells={cells} columns={day ? "grid-cols-[auto_repeat(3,minmax(0,1fr))]"
                                        : "grid-cols-[auto_repeat(2,minmax(0,1fr))]"} />
  );
}

function Meta({ item, topic = false, children }: {
  item: RoadmapItem; topic?: boolean; children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-meta">
      <DifficultyMeter difficulty={item.difficulty} />
      <TrackLabel track={item.track} topic={topic ? item.topic : null} />
      <span className="text-text-dim">About {item.estMinutes} min</span>
      {children}
    </div>
  );
}

/** Zero attempts: the first problem on the path, and one button. */
export function StartCard({ item }: { item: RoadmapItem }) {
  return (
    <section aria-labelledby="start" className="rounded-panel border border-border bg-surface p-6">
      <p className="text-text-dim">Your first problem</p>
      <h2 id="start" className="mt-1 text-title font-semibold tracking-[-0.01em] text-text">
        {item.title}
      </h2>
      <div className="mt-2.5"><Meta item={item} topic /></div>
      <ButtonLink href={problemHref(item.slug)} variant="primary" size="lg" className="mt-6">
        Open the problem <ArrowRight aria-hidden />
      </ButtonLink>
    </section>
  );
}

/**
 * docs/01 S2: three cards from the path, skipping solved problems. The
 * problem the learner last left unfinished, when there is one, comes first.
 */
export function NextUp({ items, resumed }: { items: RoadmapItem[]; resumed: string | null }) {
  return (
    <section aria-labelledby="next-up">
      <SectionHeading id="next-up" title="Next up" />
      <ol className="mt-4 grid grid-cols-3 gap-4">
        {items.map((item) => (
          <li key={item.slug} className="flex flex-col rounded-panel border border-border bg-surface p-4">
            {item.slug === resumed ? (
              <p className="mb-1 text-meta text-text-dim">Pick up where you left off</p>
            ) : null}
            <h3 className="font-semibold text-text">{item.title}</h3>
            <div className="mt-2">
              <Meta item={item}>
                <span className="text-text-dim">
                  {item.competencyCount} {item.competencyCount === 1 ? "competency" : "competencies"}
                </span>
              </Meta>
            </div>
            <div className="mt-auto pt-4">
              <ButtonLink href={problemHref(item.slug)} size="sm" aria-label={`Open ${item.title}`}>
                Open
              </ButtonLink>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Nothing left on the path: the next thing worth doing is a sitting. */
export function PathComplete() {
  return (
    <section aria-labelledby="path-complete" className="rounded-panel border border-border bg-surface p-6">
      <h2 id="path-complete" className="text-title font-semibold tracking-[-0.01em] text-text">
        Every problem on your path is passed
      </h2>
      <ButtonLink href="/rehearsal" variant="primary" size="lg" className="mt-6">
        Sit a rehearsal <ArrowRight aria-hidden />
      </ButtonLink>
    </section>
  );
}

/** docs/01 S2: at most four rows, the two strongest and the two weakest touched. */
export function CompetencyBars({ bars }: { bars: CompetencyBar[] }) {
  return (
    <section aria-labelledby="competencies">
      <SectionHeading id="competencies" title="Your competencies"
                      action={<Link href="/progress" className="hover:text-text">Full heatmap</Link>} />
      <ul className="mt-4 divide-y divide-border rounded-panel border border-border bg-surface">
        {bars.map((bar) => (
          <li key={bar.slug} className="grid h-9 grid-cols-[14rem_minmax(0,1fr)_8rem] items-center gap-4 px-3">
            <span className="truncate text-text">{bar.name.charAt(0).toUpperCase() + bar.name.slice(1)}</span>
            <span aria-hidden className="flex h-1 gap-0.5">
              {Array.from({ length: 10 }, (_, i) => (
                <span key={i} className={cn("flex-1 rounded-full",
                  i < bar.filled ? "bg-text-dim" : "bg-border-strong")} />
              ))}
            </span>
            <span className="text-right text-meta text-text-dim">{bar.label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The last five finished attempts. */
export function RecentActivity({ rows }: { rows: ActivityRow[] }) {
  return (
    <section aria-labelledby="recent">
      <SectionHeading id="recent" title="Recent activity"
                      action={<Link href="/progress#history" className="hover:text-text">Full history</Link>} />
      {rows.length ? (
        <Table className="mt-4" widths={[128, null, 128, 96]} head={
          <Head>
            <Cell head>Result</Cell>
            <Cell head>Problem</Cell>
            <Cell head>When</Cell>
            <NumCell head>Submits</NumCell>
          </Head>
        }>
          {rows.map((row) => (
            <Row key={row.slug} className="hover:bg-surface-2">
              <Cell>
                {row.submitted ? (
                  <span className="inline-flex items-center gap-1.5 text-text-dim">
                    <StatusIcon kind={row.verdict === "pass" ? "pass" : "fail"} />
                    {row.verdict === "pass" ? "Passed" : "Not yet"}
                  </span>
                ) : (
                  // Run checks the public tests only, so its pass is no
                  // result for the problem.
                  <span className="text-text-faint">Not submitted yet</span>
                )}
              </Cell>
              <Cell>
                <Link href={problemHref(row.slug)} className="font-medium text-text hover:text-accent">
                  {row.title}
                </Link>
              </Cell>
              <Cell className="text-text-dim">{row.whenLabel}</Cell>
              <NumCell className="text-text-dim">{row.submits}</NumCell>
            </Row>
          ))}
        </Table>
      ) : (
        <EmptyState icon={History} className="mt-4">
          Nothing finished yet. Run or submit a problem and it lands here.
        </EmptyState>
      )}
    </section>
  );
}
