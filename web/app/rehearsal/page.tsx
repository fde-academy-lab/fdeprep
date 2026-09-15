/**
 * The rehearsal entry, S8.
 *
 * "Entering rehearsal requires a confirmation that names the duration and the
 * remaining weekly allowance." Both numbers come from the modules that own
 * them rather than being restated here.
 */
import Link from "next/link";
import Nav from "../nav";
import { DURATION_MINUTES, PROBLEM_COUNT } from "@/lib/rehearsal";
import { allowanceFor } from "@/lib/policy";
import { currentLearner } from "@/lib/session/current";
import { db } from "@/lib/db/pool";
import StartButton from "./start-button";

export const dynamic = "force-dynamic";

export default async function RehearsalPage() {
  const learner = await currentLearner();
  const allowance = await allowanceFor({
    enrolmentId: learner.enrolmentId, difficulty: "extreme", scope: "rehearsal_weekly",
  });

  const { rows: past } = await db().query<{
    id: string; started_at: Date; finished_at: Date | null; report: { score?: number } | null;
  }>(
    `select id, started_at, finished_at, report from rehearsal
      where enrolment_id = $1 order by started_at desc limit 5`, [learner.enrolmentId]);

  return (
    <main className="mx-auto max-w-3xl">
      <Nav active="rehearsal" />

      <section className="border-b border-border px-4 py-6">
        <h1 className="mb-2">Rehearsal</h1>
        <p className="mb-4 text-text-dim">
          {PROBLEM_COUNT} problems drawn from your roadmap, run under Extreme rules whatever
          their own tier says: no hints, no test names, no acceptance rates, one submit each.
          The sitting lasts {DURATION_MINUTES} minutes and the sequence is fixed.
        </p>

        <p className="tnum mb-4">
          {allowance.remaining} of {allowance.max} rehearsals left this week.
        </p>

        {allowance.remaining > 0 ? (
          <StartButton durationMinutes={DURATION_MINUTES} problemCount={PROBLEM_COUNT}
                       remaining={allowance.remaining} />
        ) : (
          <p className="text-warn">
            You have used both rehearsals this week. The next one opens in{" "}
            {allowance.resetInS === null ? "a while" : humanise(allowance.resetInS)}.
          </p>
        )}
      </section>

      <section className="px-4 py-4">
        <h2 className="mb-3 text-text-dim">PAST SITTINGS</h2>
        {past.length ? (
          <table className="w-full text-left">
            <tbody>
              {past.map((row) => (
                <tr key={row.id} className="border-t border-border">
                  <td className="py-2 pr-4 text-text-dim">
                    {row.started_at.toISOString().slice(0, 10)}
                  </td>
                  <td className="py-2 pr-4">
                    {row.finished_at ? "finished" : "not finished"}
                  </td>
                  <td className="tnum py-2 pr-4">
                    {row.report?.score === undefined ? "--" : row.report.score}
                  </td>
                  <td className="py-2">
                    <Link href={`/rehearsal/${row.id}`} className="text-accent">
                      {row.finished_at ? "report" : "resume"}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-text-dim">No sittings yet. The first one starts above.</p>
        )}
      </section>
    </main>
  );
}

function humanise(seconds: number): string {
  const hours = Math.ceil(seconds / 3600);
  if (hours < 24) return `${hours} hours`;
  const days = Math.ceil(hours / 24);
  return days === 1 ? "a day" : `${days} days`;
}
