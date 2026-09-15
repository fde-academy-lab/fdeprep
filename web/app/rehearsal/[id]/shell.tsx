"use client";

/**
 * The stripped shell. No navigation, a countdown, a fixed sequence.
 *
 * The countdown is drawn from the server's end time rather than counted up
 * from page load, so refreshing the page does not buy more minutes.
 */
import Link from "next/link";
import { useEffect, useState } from "react";

interface ShellProblem {
  problemId: number;
  slug: string;
  title: string;
  ordinal: number;
  verdict: string | null;
}

export default function Shell({ report }: {
  report: { id: number; endsAt: string; problems: ShellProblem[] };
}) {
  const [left, setLeft] = useState(() => remaining(report.endsAt));

  useEffect(() => {
    const timer = setInterval(() => setLeft(remaining(report.endsAt)), 1000);
    return () => clearInterval(timer);
  }, [report.endsAt]);

  return (
    <main className="mx-auto max-w-3xl">
      <header className="flex items-baseline justify-between border-b border-border px-4 py-3">
        <h1>Rehearsal</h1>
        <span className={`tnum ${left.urgent ? "text-warn" : "text-text-dim"}`}>
          {left.label} left
        </span>
      </header>

      <ol className="px-4 py-4">
        {report.problems.map((problem) => (
          <li key={problem.problemId} className="flex items-baseline gap-3 border-b
                                                 border-border py-3">
            <span className="tnum w-6 text-text-dim">{problem.ordinal}</span>
            <span className="grow">{problem.title}</span>
            {problem.verdict ? (
              <span className={problem.verdict === "pass" ? "text-pass" : "text-warn"}>
                {problem.verdict}
              </span>
            ) : (
              <Link href={`/problems/${problem.slug}?rehearsal=${report.id}`}
                    className="rounded border border-border px-2 py-1 hover:border-accent">
                Open
              </Link>
            )}
          </li>
        ))}
      </ol>

      <p className="px-4 pb-6 text-text-dim">
        One submit each, no hints, no test names. The report opens when the clock runs out or
        when every problem has been submitted.
      </p>
    </main>
  );
}

function remaining(endsAt: string): { label: string; urgent: boolean } {
  const ms = Math.max(0, new Date(endsAt).getTime() - Date.now());
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  return {
    label: `${minutes}:${String(seconds).padStart(2, "0")}`,
    urgent: ms < 5 * 60_000,
  };
}
