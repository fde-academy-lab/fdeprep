/**
 * The rehearsal entry, S8.
 *
 * "Entering rehearsal requires a confirmation that names the duration and the
 * remaining weekly allowance." Both numbers come from the modules that own
 * them rather than being restated here.
 */
import Link from "next/link";
import type { Metadata, Route } from "next";
import { CalendarClock, ListChecks, Timer, TimerOff } from "lucide-react";
import { DURATION_MINUTES, PROBLEM_COUNT } from "@/lib/rehearsal";
import { allowanceFor } from "@/lib/policy";
import { currentLearner } from "@/lib/session/current";
import { db } from "@/lib/db/pool";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusIcon } from "@/components/ui/status";
import StartButton from "./start-button";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Rehearsal" };

export default async function RehearsalPage() {
  const learner = await currentLearner();
  const allowance = await allowanceFor({
    enrolmentId: learner.enrolmentId, difficulty: "extreme", scope: "rehearsal_weekly",
  });

  const { rows: past } = await db().query<{
    id: string; started_at: Date; finished_at: Date | null; report: { score?: number } | null;
  }>(
    `select id, started_at, finished_at, report from rehearsal
      where enrolment_id = $1 order by started_at desc limit 8`, [learner.enrolmentId]);

  return (
    <main className="mx-auto max-w-[1280px] px-4 pb-16 pt-8 sm:px-6">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <section>
          <h1 className="text-display font-semibold tracking-[-0.02em] text-text">Rehearsal</h1>
          <p className="mt-2 max-w-[62ch] text-lead leading-relaxed text-text-dim">
            {PROBLEM_COUNT} problems drawn from your path, run under screen conditions whatever
            their own tier says: the brief only, a blank editor, no hints, no coach, no test names,
            one submit each. It is the room you are preparing for, and it is timed.
          </p>

          <dl className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-panel border border-border bg-border sm:grid-cols-4">
            <Fact icon={<Timer aria-hidden className="size-4" />} label="Length" value={`${DURATION_MINUTES} min`} />
            <Fact icon={<ListChecks aria-hidden className="size-4" />} label="Problems" value={String(PROBLEM_COUNT)} />
            <Fact icon={<CalendarClock aria-hidden className="size-4" />} label="Left this week"
                  value={`${allowance.remaining} of ${allowance.max}`} />
            <Fact icon={<TimerOff aria-hidden className="size-4" />} label="Order" value="Fixed" />
          </dl>

          <div className="mt-8">
            {allowance.remaining > 0 ? (
              <StartButton durationMinutes={DURATION_MINUTES} problemCount={PROBLEM_COUNT}
                           remaining={allowance.remaining} />
            ) : (
              <p className="rounded-control border border-warn/40 bg-warn-soft px-3 py-2.5 text-text">
                You have used both rehearsals this week. The next one opens in{" "}
                {allowance.resetInS === null ? "a while" : humanise(allowance.resetInS)}.
              </p>
            )}
          </div>
        </section>

        <section>
          <h2 className="text-title font-semibold tracking-[-0.01em] text-text">Past sittings</h2>
          {past.length ? (
            <ul className="mt-4 divide-y divide-border overflow-hidden rounded-panel border border-border">
              {past.map((row) => (
                <li key={row.id}>
                  <Link href={`/rehearsal/${row.id}` as Route}
                        className="flex items-center gap-3 bg-surface px-4 py-3 hover:bg-surface-2">
                    <StatusIcon kind={row.finished_at ? "pass" : "running"}
                                label={row.finished_at ? "Finished" : "In progress"} />
                    <span className="grow">
                      <span className="block text-text">
                        {row.started_at.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                      </span>
                      <span className="text-meta text-text-faint">
                        {row.finished_at ? "Finished, report ready" : "Not finished, resume it"}
                      </span>
                    </span>
                    <span className="tnum font-mono text-title font-semibold text-text">
                      {row.report?.score === undefined ? "" : Math.round(row.report.score)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={Timer} className="mt-4">
              No sittings yet. Start one when you can give it {DURATION_MINUTES} uninterrupted minutes.
            </EmptyState>
          )}
        </section>
      </div>
    </main>
  );
}

function Fact({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-surface px-4 py-3.5">
      <dt className="flex items-center gap-1.5 text-meta text-text-faint">{icon}{label}</dt>
      <dd className="tnum mt-1 text-title font-semibold text-text">{value}</dd>
    </div>
  );
}

function humanise(seconds: number): string {
  const hours = Math.ceil(seconds / 3600);
  if (hours < 24) return `${hours} hours`;
  const days = Math.ceil(hours / 24);
  return days === 1 ? "a day" : `${days} days`;
}
