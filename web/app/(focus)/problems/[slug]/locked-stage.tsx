/**
 * A build stage that has not opened yet. The page sends the situation and the
 * way back to the stage before, and never the starter code, which carries the
 * previous stage's work.
 */
import Link from "next/link";
import type { Route } from "next";
import { ArrowLeft, Lock } from "lucide-react";
import type { BuildLock } from "@/lib/policy";
import type { WorkspaceProblem } from "@/lib/problems/workspace";
import { ButtonLink } from "@/components/ui/button";
import { LogoMark } from "@/components/ui/logo";
import { ScenarioCard } from "@/components/workspace/scenario-card";
import { renderCode } from "@/components/ui/code";

export function LockedStage({ problem, lock }: { problem: WorkspaceProblem; lock: BuildLock }) {
  const build = problem.kit.build;
  return (
    <div className="min-h-dvh">
      <header className="flex h-12 items-center gap-3 border-b border-border px-3">
        <Link href="/" aria-label="FDE Prep home"><LogoMark /></Link>
        <Link href="/problems" className="text-text-dim hover:text-text">Problems</Link>
      </header>
      <main className="mx-auto max-w-2xl px-5 py-14">
        <p className="inline-flex items-center gap-2 rounded-full border border-border-strong px-3 py-1
                      text-meta text-text-dim">
          <Lock aria-hidden className="size-3.5" />
          {build ? <>{renderCode(build.title)}, stage {build.stage} of {build.of}</> : "Locked stage"}
        </p>
        <h1 className="mt-4 text-display font-semibold tracking-[-0.015em] text-text">{problem.title}</h1>
        <p className="mt-3 text-lead text-text-dim">{lock.reason}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <ButtonLink variant="primary" size="lg" href={`/problems/${lock.previous.slug}` as Route}>
            <ArrowLeft aria-hidden /> Finish stage {lock.previous.stage}
          </ButtonLink>
          <ButtonLink variant="ghost" size="lg" href="/">Back to your path</ButtonLink>
        </div>
        {problem.kit.scenario ? (
          <div className="mt-10">
            <p className="mb-3 text-meta text-text-faint">What this stage is about</p>
            <ScenarioCard scenario={problem.kit.scenario} />
          </div>
        ) : null}
      </main>
    </div>
  );
}
