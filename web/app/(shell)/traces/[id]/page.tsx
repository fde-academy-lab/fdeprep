/**
 * Screen S7, the trace replay viewer.
 *
 * docs/01 S7: on a failed Extreme submission the trace is available, because
 * the learning happens there even though the attempt is spent. The replay
 * module decides how much of it each reader gets: a learner reads the public
 * cases and one anonymous row per unpublished case, and faculty and admins
 * read every case.
 */
import Link from "next/link";
import type { Metadata, Route } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft, Route as Route_ } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { ButtonLink } from "@/components/ui/button";
import { replayFor } from "@/lib/trace/replay";
import { permits } from "@/lib/admin/guard";
import { db } from "@/lib/db/pool";
import { currentLearner } from "@/lib/session/current";
import Replay from "./replay";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Trace replay" };

export default async function TracePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const submissionId = Number(id);
  if (!Number.isInteger(submissionId)) notFound();

  const learner = await currentLearner();

  // The enrolment comes from the session, so a learner cannot read another
  // learner's trace by changing the number in the address bar. Faculty and
  // admins read any learner's traces (docs/00 section 2), which is what the
  // Trace links on Submissions and on a learner's admin page open.
  const { rows } = await db().query<{ slug: string; title: string; wall_ms: number | null }>(
    `select p.slug, p.title, s.wall_ms
       from submission s
       join attempt a on a.id = s.attempt_id
       join problem_version v on v.id = s.problem_version_id
       join problem p on p.id = v.problem_id
      where s.id = $1 and (a.enrolment_id = $2 or $3)`,
    [submissionId, learner.enrolmentId, permits(learner.role, "faculty")]);
  const owner = rows[0];
  if (!owner) notFound();

  const replay = await replayFor(submissionId,
    { audience: permits(learner.role, "faculty") ? "faculty" : "learner" });

  return (
    <main className="mx-auto max-w-[1280px] px-4 pb-16 pt-8 sm:px-6">
      <Link href={`/problems/${owner.slug}` as Route}
            className="inline-flex items-center gap-1.5 text-meta text-text-dim hover:text-text">
        <ArrowLeft aria-hidden className="size-3.5" /> {owner.title}
      </Link>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-display font-semibold tracking-[-0.02em] text-text">Trace replay</h1>
        <p className="tnum text-text-dim">
          {replay.llmCalls} model calls, {replay.toolCalls} tool calls
          {replay.refusedCalls ? `, ${replay.refusedCalls} refused` : ""}
          {owner.wall_ms === null ? "" : `, ${(owner.wall_ms / 1000).toFixed(1)} s wall time`}
        </p>
      </div>

      {replay.flags.length ? (
        <ul className="mt-4 flex flex-wrap gap-1.5">
          {replay.flags.map((flag) => (
            <li key={flag} className="rounded-full border border-warn/40 bg-warn-soft px-2.5 py-0.5 text-meta text-text">
              {flag.replace(/_/g, " ")}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-6">
        {replay.available ? (
          <Replay replay={replay} />
        ) : (
          <EmptyState icon={Route_} action={<ButtonLink href={`/problems/${owner.slug}` as Route} size="sm">Back to the problem</ButtonLink>}>
            This submission has no trace. Prompt and design submissions are judged rather than run,
            so there is no loop to replay.
          </EmptyState>
        )}
      </div>

      {replay.truncated ? (
        <p className="mt-3 text-meta text-text-faint">
          The trace was longer than the cap, so the middle steps were dropped.
        </p>
      ) : null}
    </main>
  );
}
