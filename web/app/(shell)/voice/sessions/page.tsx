/** Past answers, newest first, each one a way into its debrief. */
import Link from "next/link";
import type { Metadata, Route } from "next";
import { Mic } from "lucide-react";
import { pastSessions } from "@/lib/voice/debrief";
import { currentLearner } from "@/lib/session/current";
import { EmptyState } from "@/components/ui/empty-state";
import { ButtonLink } from "@/components/ui/button";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Past answers" };

export default async function PastSessionsPage() {
  const learner = await currentLearner();
  const sessions = await pastSessions(learner.enrolmentId);

  return (
    <main className="mx-auto max-w-[1280px] px-4 pb-16 pt-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-display font-semibold tracking-[-0.02em] text-text">Past answers</h1>
          <p className="mt-1 text-text-dim">Every answer you finished, spoken or typed, with its debrief.</p>
        </div>
        <ButtonLink href="/voice" variant="primary"><Mic aria-hidden /> Answer a question</ButtonLink>
      </div>

      {sessions.length === 0 ? (
        <EmptyState icon={Mic} className="mt-8"
                    action={<ButtonLink href="/voice" size="sm">Pick a question</ButtonLink>}>
          You have not finished an answer yet. Pick a question; each one runs two to three minutes.
        </EmptyState>
      ) : (
        <div className="mt-8 overflow-x-auto rounded-panel border border-border">
          <table className="w-full min-w-[640px] border-collapse text-left">
            <thead className="bg-surface-2 text-meta text-text-faint">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-medium">Question</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Mode</th>
                <th scope="col" className="px-4 py-2.5 font-medium">When</th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">Score</th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">Audio</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-surface">
              {sessions.map((session) => (
                <tr key={session.id} className="hover:bg-surface-2">
                  <td className="px-4 py-3">
                    <Link href={`/voice/sessions/${session.id}` as Route} className="font-medium text-text hover:text-accent">
                      {session.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3 capitalize text-text-dim">{session.mode}</td>
                  <td className="px-4 py-3 text-text-dim">{new Date(session.startedAt).toLocaleDateString()}</td>
                  <td className="tnum px-4 py-3 text-right font-mono text-text">
                    {session.notCounted ? "Not counted" : session.score === null ? "Scoring"
                      : Math.round(session.score)}
                  </td>
                  <td className="px-4 py-3 text-right text-text-dim">
                    {session.input === "typed" ? "Typed" : session.hasAudio ? "Kept" : "Deleted"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
