/** Past answers, newest first, each one a way into its debrief. */
import Link from "next/link";
import { pastSessions } from "@/lib/voice/debrief";
import { currentLearner } from "@/lib/session/current";

export const dynamic = "force-dynamic";

export default async function PastSessionsPage() {
  const learner = await currentLearner();
  const sessions = await pastSessions(learner.enrolmentId);

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="text-xl font-semibold">Past answers</h1>

      {sessions.length === 0 ? (
        <p className="mt-6 border border-border bg-surface p-8 text-center text-text-dim">
          You have not finished a spoken answer yet.{" "}
          <Link href={{ pathname: "/voice/session", query: { mode: "guided" } }} className="text-accent">
            Answer one
          </Link>
          .
        </p>
      ) : (
        <table className="mt-6 w-full border-collapse text-left">
          <thead className="text-xs uppercase tracking-wide text-text-faint">
            <tr className="border-b border-border">
              <th scope="col" className="py-2">Question</th>
              <th scope="col" className="py-2">Mode</th>
              <th scope="col" className="py-2">When</th>
              <th scope="col" className="py-2 text-right">Score</th>
              <th scope="col" className="py-2 text-right">Audio</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((session) => (
              <tr key={session.id} className="border-b border-border hover:bg-surface">
                <td className="py-2">
                  <Link
                    href={`/voice/sessions/${session.id}`}
                    className="hover:text-accent"
                  >
                    {session.title}
                  </Link>
                </td>
                <td className="py-2 capitalize text-text-dim">{session.mode}</td>
                <td className="py-2 text-text-dim">
                  {new Date(session.startedAt).toLocaleDateString()}
                </td>
                <td className="py-2 text-right tnum">
                  {session.score === null ? "--" : Math.round(session.score)}
                </td>
                <td className="py-2 text-right text-text-dim">
                  {session.hasAudio ? "kept" : "none"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
