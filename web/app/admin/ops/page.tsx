/**
 * S10 Ops: queue depth, runner error rate for the last hour, live-run token
 * spend today, cap overrides.
 *
 * Laid out in the order the docs/05 runbook reads: the numbers that decide
 * whether anything is wrong, then the stuck list that the runbook's first
 * procedure acts on, then the two switches.
 */
import { opsSnapshot, QUEUE_DEPTH_ALARM, STUCK_AFTER_MINUTES } from "@/lib/admin/ops";
import { Requeue, Switches } from "./controls";

export const dynamic = "force-dynamic";

export default async function OpsPage() {
  const snapshot = await opsSnapshot();

  return (
    <main className="px-4 py-4">
      <h1 className="mb-3">Ops</h1>

      {snapshot.degraded.on ? (
        <p className="mb-4 rounded border border-warn px-3 py-2 text-warn">
          Degraded mode is on. Submit is closed for every learner. {snapshot.degraded.reason}
        </p>
      ) : null}

      <dl className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Submissions queued" value={snapshot.queueDepth}
              warn={snapshot.queueBackingUp}
              note={snapshot.queueBackingUp
                ? `over ${QUEUE_DEPTH_ALARM}, the queue is draining`
                : "draining normally"} />
        <Stat label="Judgements queued" value={snapshot.judgeDepth} />
        <Stat label="Runner errors, last hour"
              value={`${Math.round(snapshot.errorRate * 100)}%`}
              warn={snapshot.errorRate > 0.05}
              note={`${snapshot.errorCount} of ${snapshot.eventCount} events`} />
        <Stat label="Live model calls today" value={snapshot.liveCallsToday} />
      </dl>

      <section className="mb-6">
        <h2 className="mb-2 text-text-dim">
          STUCK, over {STUCK_AFTER_MINUTES} minutes with no verdict
        </h2>
        {snapshot.stuck.length ? (
          <table className="w-full text-left">
            <thead>
              <tr className="text-text-dim">
                {["Submission", "Learner", "Problem", "Waiting", ""].map((head) => (
                  <th key={head} scope="col" className="py-1 pr-4 font-normal">{head}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {snapshot.stuck.map((row) => (
                <tr key={row.id} className="border-t border-border">
                  <td className="tnum py-2 pr-4">#{row.id}</td>
                  <td className="py-2 pr-4">{row.login}</td>
                  <td className="py-2 pr-4">{row.slug}</td>
                  <td className="tnum py-2 pr-4 text-warn">{row.waitingMinutes}m</td>
                  <td className="py-2"><Requeue submissionId={row.id} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-text-dim">
            Nothing is stuck. A submission appears here after {STUCK_AFTER_MINUTES} minutes
            without a verdict.
          </p>
        )}
      </section>

      <Switches degraded={snapshot.degraded} />
    </main>
  );
}

function Stat({ label, value, note, warn }: {
  label: string; value: string | number; note?: string; warn?: boolean;
}) {
  return (
    <div className="rounded border border-border p-3">
      <dt className="text-text-dim">{label}</dt>
      <dd className={`tnum text-2xl ${warn ? "text-warn" : ""}`}>{value}</dd>
      {note ? <dd className="text-text-faint">{note}</dd> : null}
    </div>
  );
}
