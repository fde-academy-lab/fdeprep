/**
 * The results pane for a code run, rendered from the result contract in
 * docs/03 section 5 and nothing else.
 *
 * The gates read left to right like a pipeline, because that is the order
 * they run in and the order a learner fixes them in: nothing reaches the
 * hidden tests until the static gate and the public tests are green.
 * docs/08: nothing in here animates, because an animated result reads as
 * latency.
 */
import Link from "next/link";
import type { Route } from "next";
import { ArrowUpRight, ChevronRight, CircleDashed } from "lucide-react";
import type { GateView, SubmissionView } from "@/lib/submissions/view";
import type { Visibility } from "@/lib/policy/tiers";
import { StatusBadge, StatusIcon, type StatusKind } from "@/components/ui/status";
import { cn } from "@/components/ui/cn";

const GATES = [
  { key: "static", label: "Static" },
  { key: "public", label: "Public" },
  { key: "hidden", label: "Hidden" },
  { key: "adversarial", label: "Adversarial" },
] as const;

function humanise(name: string): string {
  const words = name.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function gateKind(gate: GateView): StatusKind | "skipped" {
  if (gate.status === "skipped") return "skipped";
  return gate.status === "pass" ? "pass" : "fail";
}

export function Pipeline({ view, visibility }: { view: SubmissionView; visibility: Visibility }) {
  return (
    <ol aria-label="Gates" className="flex flex-wrap items-center gap-1.5">
      {GATES.map((gate, index) => {
        const data = view.gates[gate.key];
        const kind = gateKind(data);
        const showCount = data.total > 0 && data.status !== "skipped" &&
          (gate.key !== "hidden" || visibility.hiddenCount);
        return (
          <li key={gate.key} className="flex items-center gap-1.5">
            {index > 0 ? <ChevronRight aria-hidden className="size-3.5 text-text-faint" /> : null}
            <span className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-meta font-medium",
              kind === "pass" ? "border-pass/35 text-text"
                : kind === "fail" ? "border-fail/40 text-text"
                : "border-dashed border-border-strong text-text-faint")}>
              {kind === "skipped"
                ? <CircleDashed aria-hidden className="size-3.5" />
                : <StatusIcon kind={kind} className="[&_svg]:size-3.5" />}
              {gate.label}
              {showCount ? (
                <span className="tnum font-mono text-text-dim">{data.passed}/{data.total}</span>
              ) : null}
              {kind === "skipped" ? <span className="sr-only">not run</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function CodeResults({ view, running, notice, visibility, callBudget }: {
  view: SubmissionView | null;
  running: boolean;
  notice: string | null;
  visibility: Visibility;
  callBudget: number | null;
}) {
  if (notice) {
    return (
      <div className="results-pane p-4">
        <StatusBadge kind="error">{notice}</StatusBadge>
      </div>
    );
  }
  if (!view && !running) {
    return (
      <div className="results-pane p-4">
        <p className="text-text-dim">
          Run sends your code through the static gate and the public tests. Submit adds the hidden
          tests{visibility.hiddenCount ? "" : " and the adversarial ones"} and records the attempt.
        </p>
      </div>
    );
  }
  if (!view || view.status !== "terminal") {
    return (
      <div className="results-pane space-y-3 p-4" aria-busy="true">
        <StatusBadge kind={view?.status === "queued" || !view ? "queued" : "running"}>
          {view?.status === "running" || view?.status === "evaluating"
            ? "Running your code against the tests" : "Queued. The runner picks this up in a moment."}
        </StatusBadge>
        <div className="space-y-2">
          <div className="skeleton h-9" />
          <div className="skeleton h-9 opacity-70" />
        </div>
      </div>
    );
  }

  const cases = view.gates.public.cases;
  const pub = view.gates.public;
  const verdict = view.verdict;
  const headline =
    verdict === "rejected" ? "Rejected before it ran. Fix what the static gate names first."
    : verdict === "timeout" ? "The runner timed out. Your attempt was not counted. Try again."
    : verdict === "error" ? (view.message ?? "The runner failed. Your attempt was not counted. Try again.")
    : verdict === "pass" ? (view.kind === "run" ? "Every public test passes. Submit when you are ready."
                            : "Passed. Every gate is green.")
    : `${pub.passed} of ${pub.total} public tests pass.`;
  const headKind: StatusKind = verdict === "pass" ? "pass"
    : verdict === "error" || verdict === "timeout" ? "error" : "fail";

  return (
    <div className="results-pane space-y-4 p-4">
      {view.correction ? (
        <section className="rounded-panel border border-border-strong bg-surface-2 px-3 py-2.5">
          <p className="font-medium text-text">
            {view.correction.direction === "raised"
              ? "A reviewer raised this grade" : "A reviewer lowered this grade"}
          </p>
          <p className="mt-1 text-text-dim">{view.correction.note}</p>
          <p className="mt-1 text-meta text-text-faint">
            Your cohort lead can take this up if you think it is wrong.
          </p>
        </section>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <StatusBadge kind={headKind} className="text-lead">{headline}</StatusBadge>
        {view.modelCalls !== null && callBudget ? (
          <BudgetMeter used={view.modelCalls} budget={callBudget} />
        ) : null}
      </div>

      <Pipeline view={view} visibility={visibility} />

      {view.gates.static.status === "fail" ? (
        <ul className="space-y-1.5 rounded-panel border border-fail/30 bg-fail-soft px-3 py-2.5">
          {view.gates.static.cases.map((c) => (
            <li key={c.name} className="text-text">
              {c.message ?? humanise(c.name)}
            </li>
          ))}
          {!view.gates.static.cases.length ? (
            <li className="text-text">The static gate rejected this code before it ran.</li>
          ) : null}
        </ul>
      ) : null}

      {cases.length ? (
        <ul className="divide-y divide-border overflow-hidden rounded-panel border border-border">
          {cases.map((testCase) => (
            <li key={testCase.name} className="flex items-start gap-3 bg-surface px-3 py-2.5">
              <StatusIcon kind={testCase.status === "pass" ? "pass" : "fail"} className="mt-0.5" />
              <div className="min-w-0">
                <p className="text-text">{humanise(testCase.name)}</p>
                {testCase.message && testCase.status !== "pass" ? (
                  <p className="mt-1 whitespace-pre-wrap font-mono text-meta text-text-dim">
                    {testCase.message}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {view.gates.hidden.status === "skipped" && view.kind === "run" ? (
        <p className="text-meta text-text-faint">
          Run stops at the public tests. The hidden{visibility.hiddenCount ? "" : " and adversarial"} tests
          run when you submit.
        </p>
      ) : null}
      {view.gates.hidden.total > 0 && view.gates.hidden.status !== "skipped" &&
        !view.gates.hidden.cases.length && visibility.hiddenCount ? (
        <p className="text-text-dim">
          Hidden tests: <span className="tnum text-text">{view.gates.hidden.passed} of {view.gates.hidden.total}</span> pass.
          Their names open once you pass the problem.
        </p>
      ) : null}
      {view.gates.hidden.cases.length ? (
        <ul className="divide-y divide-border overflow-hidden rounded-panel border border-border">
          {view.gates.hidden.cases.map((testCase) => (
            <li key={testCase.name} className="flex items-start gap-3 bg-surface px-3 py-2.5">
              <StatusIcon kind={testCase.status === "pass" ? "pass" : "fail"} className="mt-0.5" />
              <p className="text-text">{humanise(testCase.name)} <span className="text-text-faint">hidden</span></p>
            </li>
          ))}
        </ul>
      ) : null}

      <Link href={`/traces/${view.id}` as Route}
            className="inline-flex items-center gap-1.5 text-accent hover:underline">
        Replay every model call and tool call from this run
        <ArrowUpRight aria-hidden className="size-3.5" />
      </Link>
    </div>
  );
}

function BudgetMeter({ used, budget }: { used: number; budget: number }) {
  const over = used > budget;
  const cells = Math.max(budget, used);
  return (
    <span className="inline-flex items-center gap-2 text-meta text-text-dim"
          title={`${used} of ${budget} model calls`}>
      <span aria-hidden className="flex gap-0.5">
        {Array.from({ length: Math.min(cells, 12) }, (_, i) => (
          <span key={i} className={cn("h-3 w-1.5 rounded-sm",
                                      i < used ? (i >= budget ? "bg-fail" : "bg-text-dim") : "bg-border-strong")} />
        ))}
      </span>
      <span className={cn("tnum", over && "text-fail")}>{used} of {budget} model calls</span>
    </span>
  );
}
