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
      <main className="mx-auto max-w-3xl px-4 py-6">
        <h1 className="mb-1">Rehearsal report</h1>
        <p className="mb-4 text-text-dim">{current.summary}</p>

        <p className="tnum mb-4">
          {current.passed} of {current.total} passed. Score {current.score}.
          Budget used: {current.llmCalls} model calls.
        </p>

        <table className="w-full text-left">
          <thead>
            <tr className="text-text-dim">
              <th scope="col" className="py-1 pr-4 font-normal">Problem</th>
              <th scope="col" className="py-1 pr-4 font-normal">Verdict</th>
              <th scope="col" className="py-1 pr-4 font-normal">Score</th>
              <th scope="col" className="py-1 font-normal">Calls</th>
            </tr>
          </thead>
          <tbody>
            {current.problems.map((row) => (
              <tr key={row.problemId} className="border-t border-border">
                <td className="py-2 pr-4">{row.title}</td>
                <td className={`py-2 pr-4 ${
                  row.verdict === "pass" ? "text-pass"
                    : row.verdict === null ? "text-text-faint" : "text-warn"}`}>
                  {row.verdict ?? "not submitted"}
                </td>
                <td className="tnum py-2 pr-4">{row.score ?? 0}</td>
                <td className="tnum py-2">{row.llmCalls ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="mt-6">
          <Link href="/rehearsal" className="text-accent">Back to rehearsals</Link>
        </p>
      </main>
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
