"use client";

/**
 * Screen S6, the design argument workspace.
 *
 * Two panes. The word count runs against the declared range as the learner
 * types, from the same module the structural gate runs on submit, so a count
 * that reads "in range" is a count the server agrees with.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { evaluateDesignStructure, wordCount } from "@/lib/gate";
import type { Decision } from "@/lib/policy";
import type { SubmissionView } from "@/lib/submissions/view";
import { useSubmission } from "./use-submission";

interface Props {
  problemId: number;
  policy: Decision;
  briefMd: string;
  wordRange: [number, number] | null;
  requiredHeadings: string[];
  rubric: Array<{ label: string; weight: number }>;
  referenceMd: string | null;
}

export default function DesignWorkspace(props: Props) {
  const [policy, setPolicy] = useState(props.policy);
  const [body, setBody] = useState("");

  const refreshPolicy = useCallback(async () => {
    const response = await fetch(`/api/problems/${props.problemId}/policy`);
    if (response.ok) setPolicy((await response.json()) as Decision);
  }, [props.problemId]);

  const { view, running, notice, send } = useSubmission(props.problemId, refreshPolicy);

  const storageKey = `fdeprep.design.${props.problemId}`;
  useEffect(() => {
    try {
      const draft = localStorage.getItem(storageKey);
      if (draft) setBody(draft);
    } catch { /* a browser with storage blocked still gets a workspace */ }
  }, [storageKey]);

  const onChange = useCallback((next: string) => {
    setBody(next);
    try { localStorage.setItem(storageKey, next); } catch { /* blocked */ }
  }, [storageKey]);

  const words = useMemo(() => wordCount(body), [body]);
  const structure = useMemo(
    () => evaluateDesignStructure(body, {
      word_range: props.wordRange ?? undefined,
      required_headings: props.requiredHeadings,
    }),
    [body, props.wordRange, props.requiredHeadings]);

  const [low, high] = props.wordRange ?? [0, 0];
  const inRange = !props.wordRange || (words >= low && words <= high);

  const onSubmit = async () => {
    if (policy.confirmBeforeSubmit &&
        !confirm("This is your only attempt today on an Extreme problem. Submit it?")) return;
    await send("submit", body);
  };

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-[38%] min-w-[300px] flex-col overflow-y-auto border-r border-border bg-surface">
        <section className="border-b border-border p-3">
          <h2 className="mb-2 text-text-dim">Brief</h2>
          <p className="whitespace-pre-wrap">{props.briefMd}</p>
        </section>

        {props.requiredHeadings.length ? (
          <section className="border-b border-border p-3">
            <h2 className="mb-2 text-text-dim">Required headings</h2>
            <ul className="space-y-1">
              {structure.checks.filter((c) => c.kind === "required_heading").map((check) => (
                <li key={check.label} className="flex gap-2">
                  <span aria-hidden className={check.status === "pass" ? "text-accent" : "text-text-dim"}>
                    {check.status === "pass" ? "[x]" : "[ ]"}
                  </span>
                  <span>{check.label}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="border-b border-border p-3">
          <h2 className="mb-2 text-text-dim">Rubric</h2>
          <ul className="space-y-1">
            {props.rubric.map((criterion) => (
              <li key={criterion.label}>
                <span className="tnum mr-2 text-text-dim">{criterion.weight}</span>
                {criterion.label}
              </li>
            ))}
          </ul>
        </section>

        {props.referenceMd ? (
          <section className="border-b border-border p-3">
            <h2 className="mb-2 text-text-dim">Reference</h2>
            <p className="whitespace-pre-wrap">{props.referenceMd}</p>
          </section>
        ) : null}
      </aside>

      <section className="flex min-h-0 flex-1 flex-col">
        <textarea value={body} onChange={(event) => onChange(event.target.value)}
                  spellCheck aria-label="Your answer"
                  placeholder="Write the plan you would put in front of them."
                  className="min-h-0 flex-1 resize-none bg-bg p-4 leading-7 outline-none" />

        <div className="flex items-center gap-3 border-t border-border px-3 py-2">
          <span className={`tnum ${inRange ? "text-text-dim" : "text-warn"}`}>
            {props.wordRange
              ? `${words} words, target ${low} to ${high}`
              : `${words} words`}
          </span>
          <button type="button" onClick={onSubmit} disabled={running || !policy.submit.allowed}
                  className="ml-auto rounded bg-accent px-3 py-1 text-bg disabled:opacity-40">
            {running ? "Judging" : policy.submit.label}
          </button>
        </div>

        <div className="max-h-[40%] overflow-y-auto border-t border-border p-3">
          {notice ? <p className="text-warn">{notice}</p> : null}
          {view ? <Result view={view} /> : (
            <p className="text-text-dim">
              Submit runs the structural checks, then the rubric judge. Each criterion comes
              back with a score and the line it was read from.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

function Result({ view }: { view: SubmissionView }) {
  if (view.status !== "terminal") return <p className="text-text-dim">Judging.</p>;
  if (view.verdict === "error") {
    return <p className="text-warn">{view.message ?? "The judge did not complete."}</p>;
  }

  const failing = view.checks.filter((c) => c.status === "fail");

  return (
    <div className="space-y-3">
      <p>
        <span className="capitalize">{view.verdict}</span>
        {view.score === null ? null : <span className="tnum"> at {view.score}</span>}
        {view.rubric.threshold === null ? null : (
          <span className="tnum text-text-dim"> against a pass mark of {view.rubric.threshold}</span>
        )}
      </p>

      {failing.length ? (
        <section>
          <h3 className="mb-1 text-text-dim">Structure</h3>
          <ul>
            {failing.map((check) => <li key={check.label}>{check.message}</li>)}
          </ul>
        </section>
      ) : null}

      {view.rubric.criteria.length ? (
        <section>
          <h3 className="mb-1 text-text-dim">Rubric</h3>
          <ul className="space-y-2">
            {view.rubric.criteria.map((criterion) => (
              <li key={criterion.label}>
                <span className="tnum mr-2">{criterion.score}/{criterion.weight}</span>
                {criterion.label}
                <span className="block text-text-dim">
                  {criterion.evidenceQuote}
                  {criterion.quoteGrounded ? null : " (paraphrased, not a direct quote)"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
