/**
 * The rehearsal shell and its report, S8.
 *
 * "A stripped shell with no navigation, a countdown in the header, and a
 * problem sequence the learner cannot reorder." No nav here on purpose: a
 * rehearsal that a learner can click out of into the roadmap is not a sitting.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { finishRehearsal, reportFor } from "@/lib/rehearsal";
import { currentLearner } from "@/lib/session/current";
import { LogoMark } from "@/components/ui/logo";
import { ButtonLink } from "@/components/ui/button";
import { StatusIcon } from "@/components/ui/status";
import Shell from "./shell";

export const dynamic = "force-dynamic";

export default async function RehearsalShell({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rehearsalId = Number(id);
  if (!Number.isInteger(rehearsalId)) notFound();

  const learner = await currentLearner();
  const report = await reportFor(rehearsalId).catch(() => null);
  if (!report) notFound();
  // The enrolment comes from the session, so one learner cannot open another's
  // sitting by changing the number.
  if (report.enrolmentId !== learner.enrolmentId) notFound();

  const expired = report.endsAt.getTime() <= Date.now();
  // A sitting whose clock ran out is closed on read rather than waiting for the
  // learner to come back and close it, so the report is the same either way.
  if (!report.finishedAt && expired) await finishRehearsal(rehearsalId);
  const current = report.finishedAt || expired ? await reportFor(rehearsalId) : report;

  if (current.finishedAt || expired) {
    return (
      <div className="min-h-dvh">
        <header className="flex h-12 items-center gap-3 border-b border-border px-4">
          <Link href="/" aria-label="FDE Prep home"><LogoMark /></Link>
          <Link href="/rehearsal" className="text-text-dim hover:text-text">Rehearsals</Link>
        </header>
        <main className="mx-auto max-w-3xl px-5 pb-16 pt-10">
          <h1 className="text-display font-semibold tracking-[-0.02em] text-text">Rehearsal report</h1>
          <p className="mt-2 text-lead leading-relaxed text-text-dim">{current.summary}</p>

          <dl className="mt-8 grid grid-cols-3 divide-x divide-border overflow-hidden rounded-panel border border-border bg-surface">
            <div className="px-5 py-4">
              <dt className="text-meta text-text-faint">Passed</dt>
              <dd className="tnum mt-1 text-title font-semibold text-text">{current.passed} of {current.total}</dd>
            </div>
            <div className="px-5 py-4">
              <dt className="text-meta text-text-faint">Score</dt>
              <dd className="tnum mt-1 text-title font-semibold text-text">{current.score}</dd>
            </div>
            <div className="px-5 py-4">
              <dt className="text-meta text-text-faint">Model calls</dt>
              <dd className="tnum mt-1 text-title font-semibold text-text">{current.llmCalls}</dd>
            </div>
          </dl>

          <ul className="mt-8 divide-y divide-border overflow-hidden rounded-panel border border-border">
            {current.problems.map((row) => (
              <li key={row.problemId} className="flex items-center gap-4 bg-surface px-4 py-3">
                <StatusIcon kind={row.verdict === "pass" ? "pass" : row.verdict === null ? "untouched" : "fail"}
                            label={row.verdict === "pass" ? "Passed" : row.verdict === null ? "Not submitted" : "Failed"} />
                <span className="grow text-text">{row.title}</span>
                <span className="tnum text-meta text-text-dim">
                  {row.verdict === null ? "Not submitted" : `Score ${row.score ?? 0}, ${row.llmCalls ?? 0} calls`}
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-8">
            <ButtonLink href="/rehearsal" variant="secondary">Back to rehearsals</ButtonLink>
          </div>
        </main>
      </div>
    );
  }

  return <Shell report={{
    id: current.id,
    endsAt: current.endsAt.toISOString(),
    problems: current.problems.map((p) => ({
      problemId: p.problemId, slug: p.slug, title: p.title,
      ordinal: p.ordinal, verdict: p.verdict,
    })),
  }} />;
}
