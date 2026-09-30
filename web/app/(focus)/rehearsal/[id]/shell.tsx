"use client";

/**
 * The stripped shell. No navigation, a countdown, a fixed sequence.
 *
 * The countdown is drawn from the server's end time rather than counted up
 * from page load, so refreshing the page does not buy more minutes.
 * docs/08: 40px is the clock and nothing else.
 */
import Link from "next/link";
import type { Route } from "next";
import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { LogoMark } from "@/components/ui/logo";
import { StatusBadge } from "@/components/ui/status";
import { cn } from "@/components/ui/cn";

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

  const next = report.problems.find((p) => !p.verdict);

  return (
    <div className="min-h-dvh">
      <header className="flex h-12 items-center gap-3 border-b border-border px-4">
        <LogoMark />
        <span className="font-semibold text-text">Rehearsal</span>
        <span className="text-meta text-text-faint">Screen conditions</span>
      </header>
      <main className="mx-auto max-w-2xl px-5 pb-16 pt-10">
        <p className="text-meta text-text-faint">Time left</p>
        <p role="timer" aria-live="off"
           className={cn("tnum font-mono text-clock font-semibold tracking-tight",
                         left.urgent ? "text-warn" : "text-text")}>
          {left.label}
        </p>

        <ol className="mt-8 divide-y divide-border overflow-hidden rounded-panel border border-border">
          {report.problems.map((problem) => (
            <li key={problem.problemId}
                className={cn("flex items-center gap-4 bg-surface px-4 py-3.5",
                              problem === next && "bg-surface-2")}>
              <span className="tnum w-5 font-mono text-text-faint">{problem.ordinal}</span>
              <span className="grow text-text">{problem.title}</span>
              {problem.verdict ? (
                <StatusBadge kind={problem.verdict === "pass" ? "pass" : "fail"}>
                  {problem.verdict === "pass" ? "Passed" : "Submitted"}
                </StatusBadge>
              ) : (
                <Link href={`/problems/${problem.slug}?rehearsal=${report.id}` as Route}
                      className={cn("inline-flex items-center gap-1.5 rounded-control px-3 py-1.5 font-medium",
                                    problem === next ? "bg-text text-bg hover:bg-white"
                                      : "border border-border-strong text-text-dim hover:text-text")}>
                  Open <ArrowRight aria-hidden className="size-3.5" />
                </Link>
              )}
            </li>
          ))}
        </ol>

        <p className="mt-6 text-text-dim">
          One submit each, no hints, no coach, no test names. The report opens when the clock runs
          out or when every problem has been submitted.
        </p>
      </main>
    </div>
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
