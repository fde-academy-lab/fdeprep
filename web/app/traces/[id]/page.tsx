/**
 * Screen S7, the trace replay viewer.
 *
 * docs/01 S7: on a failed Extreme submission the trace is available, because
 * the learning happens there even though the attempt is spent. So this page
 * never withholds the trace. What waits is the fixture author's annotation,
 * which the replay module gates.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import Nav from "../../nav";
import { replayFor } from "@/lib/trace/replay";
import { db } from "@/lib/db/pool";
import { currentLearner } from "@/lib/session/current";
import Replay from "./replay";

export const dynamic = "force-dynamic";

export default async function TracePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const submissionId = Number(id);
  if (!Number.isInteger(submissionId)) notFound();

  const learner = await currentLearner();

  // The enrolment comes from the session, so a learner cannot read another
  // learner's trace by changing the number in the address bar.
  const { rows } = await db().query<{ slug: string; title: string; wall_ms: number | null }>(
    `select p.slug, p.title, s.wall_ms
       from submission s
       join attempt a on a.id = s.attempt_id
       join problem_version v on v.id = s.problem_version_id
       join problem p on p.id = v.problem_id
      where s.id = $1 and a.enrolment_id = $2`,
    [submissionId, learner.enrolmentId]);
  const owner = rows[0];
  if (!owner) notFound();

  const replay = await replayFor(submissionId);

  return (
    <main className="mx-auto max-w-5xl">
      <Nav active="problems" />

      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b
                         border-border px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <Link href={`/problems/${owner.slug}`} className="text-text-dim hover:text-accent">
            &lt; {owner.title}
          </Link>
          <h1>Trace: submission #{submissionId}</h1>
        </div>
        <p className="tnum text-text-dim">
          {replay.llmCalls} model calls, {replay.toolCalls} tool calls
          {owner.wall_ms === null ? "" : `, wall ${(owner.wall_ms / 1000).toFixed(1)}s`}
        </p>
      </header>

      {replay.flags.length ? (
        <section className="border-b border-border px-4 py-2">
          <ul className="flex flex-wrap gap-2">
            {replay.flags.map((flag) => (
              <li key={flag} className="rounded border border-warn px-2 py-0.5 text-warn">
                {flag.replace(/_/g, " ")}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {replay.available ? (
        <Replay replay={replay} />
      ) : (
        <p className="px-4 py-6 text-text-dim">
          This submission has no trace. Prompt and design submissions are judged rather than
          run, so there is no loop to replay.
        </p>
      )}

      {replay.truncated ? (
        <p className="px-4 pb-4 text-text-dim">
          The trace was longer than the cap, so the middle steps were dropped.
        </p>
      ) : null}
    </main>
  );
}
