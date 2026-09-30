/**
 * Results for a prompt or design submission: the static rules, the probes and
 * the rubric, in the order they ran. Rendered from the result contract only.
 *
 * Every rubric score arrives with the line of the answer it was read from.
 * A score with no evidence is a score nobody can appeal, so the quote is
 * shown at the same weight as the number.
 */
import type { SubmissionView } from "@/lib/submissions/view";
import type { GateCheck } from "@/lib/gate";
import { StatusBadge, StatusIcon, type StatusKind } from "@/components/ui/status";
import { cn } from "@/components/ui/cn";

function humanise(name: string): string {
  const words = name.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function LocalChecks({ checks, title }: { checks: GateCheck[]; title: string }) {
  const failing = checks.filter((c) => c.status === "fail");
  return (
    <div className="space-y-3">
      <StatusBadge kind={failing.length ? "fail" : "pass"}>
        {failing.length ? `${failing.length} of ${checks.length} ${title} still fail`
          : `Every ${title.replace(/s$/, "")} passes. Submit runs the rest.`}
      </StatusBadge>
      {failing.length ? (
        <ul className="divide-y divide-border overflow-hidden rounded-panel border border-border">
          {failing.map((check) => (
            <li key={check.label} className="flex items-start gap-3 bg-surface px-3 py-2.5">
              <StatusIcon kind="fail" className="mt-0.5" />
              <div className="min-w-0">
                <p className="text-text">{check.label}</p>
                {check.message ? <p className="mt-0.5 text-meta text-text-dim">{check.message}</p> : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function JudgedResults({ view, running, notice, idle }: {
  view: SubmissionView | null;
  running: boolean;
  notice: string | null;
  /** What the pane says before anything has been submitted. */
  idle: React.ReactNode;
}) {
  if (notice) {
    return <div className="results-pane p-4"><StatusBadge kind="error">{notice}</StatusBadge></div>;
  }
  if (!view && !running) return <div className="results-pane p-4">{idle}</div>;
  if (!view || view.status !== "terminal") {
    return (
      <div className="results-pane space-y-3 p-4" aria-busy="true">
        <StatusBadge kind={!view || view.status === "queued" ? "queued" : "running"}>
          {view?.status === "evaluating" ? "The judge is reading your answer"
            : "Queued. The checks run first, then the judge."}
        </StatusBadge>
        <div className="space-y-2">
          <div className="skeleton h-9" />
          <div className="skeleton h-9 opacity-70" />
          <div className="skeleton h-9 opacity-50" />
        </div>
      </div>
    );
  }

  const verdict = view.verdict;
  const kind: StatusKind = verdict === "pass" ? "pass"
    : verdict === "error" || verdict === "timeout" ? "error" : "fail";
  const failingChecks = view.checks.filter((c) => c.status === "fail");

  return (
    <div className="results-pane space-y-5 p-4">
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

      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <StatusBadge kind={kind} className="text-lead">
          {verdict === "error" ? (view.message ?? "The judge did not complete. Your attempt was not counted. Try again.")
            : verdict === "pass" ? "Passed" : "Not yet"}
        </StatusBadge>
        {view.score !== null ? (
          <span className="tnum text-text-dim">
            <span className="font-mono text-title font-semibold text-text">{Math.round(view.score)}</span>
            {view.rubric.threshold !== null ? ` against a pass mark of ${view.rubric.threshold}` : " out of 100"}
          </span>
        ) : null}
      </div>

      {failingChecks.length ? (
        <section className="space-y-2">
          <h3 className="font-semibold text-text">Checks that failed</h3>
          <ul className="divide-y divide-border overflow-hidden rounded-panel border border-fail/30">
            {failingChecks.map((check) => (
              <li key={check.label} className="flex items-start gap-3 bg-surface px-3 py-2.5">
                <StatusIcon kind="fail" className="mt-0.5" />
                <div>
                  <p className="text-text">{check.label}</p>
                  {check.message ? <p className="mt-0.5 text-meta text-text-dim">{check.message}</p> : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {view.probes.total ? (
        <section className="space-y-2">
          <h3 className="flex items-baseline justify-between font-semibold text-text">
            Probes
            <span className="tnum font-mono text-meta font-normal text-text-dim">
              {view.probes.passed}/{view.probes.total}
            </span>
          </h3>
          <ul className="divide-y divide-border overflow-hidden rounded-panel border border-border">
            {view.probes.cases.map((probe) => (
              <li key={probe.name} className="flex items-start gap-3 bg-surface px-3 py-2.5">
                <StatusIcon kind={probe.status === "pass" ? "pass" : "fail"} className="mt-0.5" />
                <div className="min-w-0">
                  <p className="text-text">{humanise(probe.name)}</p>
                  <p className="mt-0.5 text-meta text-text-faint">The reply must {probe.assertionType.replace(/_/g, " ")}.</p>
                  {probe.userMessage ? (
                    <p className="mt-1.5 rounded-control bg-surface-2 px-2.5 py-1.5 text-meta text-text-dim">
                      Asked: {probe.userMessage}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
          {view.probes.cases.some((p) => p.userMessage === null) ? (
            <p className="text-meta text-text-faint">
              What each probe asks opens once you pass, so nobody tunes a prompt to the wording.
            </p>
          ) : null}
        </section>
      ) : null}

      {view.rubric.criteria.length ? (
        <section className="space-y-2">
          <h3 className="font-semibold text-text">Rubric</h3>
          <ul className="space-y-2">
            {view.rubric.criteria.map((criterion) => {
              const share = criterion.weight ? criterion.score / criterion.weight : 0;
              return (
                <li key={criterion.label} className="rounded-panel border border-border bg-surface px-3.5 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="font-medium text-text">{criterion.label}</p>
                    <span className="tnum shrink-0 font-mono text-meta text-text-dim">
                      {criterion.score}/{criterion.weight}
                    </span>
                  </div>
                  <div aria-hidden className="mt-2 flex h-1.5 gap-0.5">
                    {Array.from({ length: 10 }, (_, i) => (
                      <span key={i} className={cn("h-full flex-1 rounded-sm",
                        i < Math.round(share * 10) ? "bg-text-dim" : "bg-border-strong")} />
                    ))}
                  </div>
                  {criterion.evidenceQuote ? (
                    <blockquote className="mt-2.5 border-l-2 border-border-control pl-3 text-text-dim">
                      {criterion.evidenceQuote}
                      {criterion.quoteGrounded ? null : (
                        <span className="text-text-faint"> (paraphrased, not a direct quote)</span>
                      )}
                    </blockquote>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
