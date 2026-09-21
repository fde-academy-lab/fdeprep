"use client";

/**
 * Screen S5, the prompt surgery workspace.
 *
 * Three editor modes, and a checklist that updates as the learner types. The
 * checklist runs lib/gate, the same module the server runs on submit, so what
 * it shows and what the submit gate decides cannot disagree. Nothing here
 * calls the network on a keystroke: the evaluation is local and debounced only
 * to keep React from re-running it on every character in a long prompt.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { diffCounts, diffLines } from "@/lib/diff";
import { evaluatePromptRules, type PromptRule, type StaticGate } from "@/lib/gate";
import type { Decision } from "@/lib/policy";
import { useSubmission } from "./use-submission";

interface Props {
  problemId: number;
  policy: Decision;
  briefMd: string;
  originalPrompt: string;
  promptRules: PromptRule[];
  probeCount: number;
  referenceMd: string | null;
}

type Mode = "original" | "edited" | "diff";

const DEBOUNCE_MS = 120;

export default function PromptWorkspace(props: Props) {
  const [policy, setPolicy] = useState(props.policy);
  const [prompt, setPrompt] = useState(props.originalPrompt);
  const [mode, setMode] = useState<Mode>("edited");
  const [touched, setTouched] = useState(false);
  const [checked, setChecked] = useState(false);

  const refreshPolicy = useCallback(async () => {
    const response = await fetch(`/api/problems/${props.problemId}/policy`);
    if (response.ok) setPolicy((await response.json()) as Decision);
  }, [props.problemId]);

  const { view, running, notice, send } = useSubmission(props.problemId, refreshPolicy);

  const storageKey = `fdeprep.prompt.${props.problemId}`;
  useEffect(() => {
    try {
      const draft = localStorage.getItem(storageKey);
      if (draft) { setPrompt(draft); setTouched(true); setMode("diff"); }
    } catch { /* a browser with storage blocked still gets a workspace */ }
  }, [storageKey]);

  const onChange = useCallback((next: string) => {
    setPrompt(next);
    if (!touched) {
      setTouched(true);
      // docs/01 S5: diff is the default after the first edit.
      setMode("diff");
    }
    try { localStorage.setItem(storageKey, next); } catch { /* blocked */ }
  }, [storageKey, touched]);

  // The debounce is the whole of the "no network call per keystroke" rule:
  // there is no request to debounce, only the local evaluation.
  const [settled, setSettled] = useState(props.originalPrompt);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(prompt), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [prompt]);

  const gate: StaticGate = useMemo(
    () => evaluatePromptRules(settled, props.promptRules), [settled, props.promptRules]);

  const diff = useMemo(
    () => diffLines(props.originalPrompt, settled), [props.originalPrompt, settled]);
  const counts = useMemo(() => diffCounts(diff), [diff]);

  const mustRemove = gate.checks.filter((c) => c.kind === "must_remove");
  const mustKeep = gate.checks.filter((c) => c.kind !== "must_remove");

  const onSubmit = async () => {
    if (policy.confirmBeforeSubmit &&
        !confirm("This is your only attempt today on an Extreme problem. Submit it?")) return;
    await send("submit", prompt);
  };

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-[34%] min-w-[280px] flex-col overflow-y-auto border-r border-border bg-surface">
        <section className="border-b border-border p-3">
          <h2 className="mb-2 text-text-dim">Brief</h2>
          <p className="whitespace-pre-wrap">{props.briefMd}</p>
        </section>

        <Checklist title="Must remove" checks={mustRemove} />
        <Checklist title="Must keep" checks={mustKeep} />

        {props.referenceMd ? (
          <section className="border-b border-border p-3">
            <h2 className="mb-2 text-text-dim">Reference</h2>
            <p className="whitespace-pre-wrap">{props.referenceMd}</p>
          </section>
        ) : null}
      </aside>

      <section className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <div className="flex gap-1" role="tablist" aria-label="Editor mode">
            {(["original", "edited", "diff"] as Mode[]).map((name) => (
              <button key={name} type="button" role="tab" onClick={() => setMode(name)}
                      aria-selected={mode === name}
                      className={`rounded px-2 py-0.5 capitalize ${
                        mode === name ? "bg-surface-2 text-text" : "text-text-dim hover:text-text"}`}>
                {name}
              </button>
            ))}
          </div>
          <span className="tnum text-text-dim">
            {counts.added} added, {counts.removed} removed
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {mode === "original" ? (
            <pre className="p-3 whitespace-pre-wrap text-text-dim">{props.originalPrompt}</pre>
          ) : null}
          {mode === "edited" ? (
            <CodeMirror value={prompt} height="100%" onChange={onChange}
                        basicSetup={{ lineNumbers: true, foldGutter: false }} />
          ) : null}
          {mode === "diff" ? <DiffPane lines={diff} /> : null}
        </div>

        <div className="flex items-center gap-3 border-t border-border px-3 py-2">
          <button type="button" onClick={() => setChecked(true)}
                  className="rounded border border-border px-3 py-1 hover:border-accent">
            Check
          </button>
          <button type="button" onClick={onSubmit} disabled={running || !policy.submit.allowed}
                  className="rounded bg-accent px-3 py-1 text-bg disabled:opacity-40">
            {running ? "Judging" : policy.submit.label}
          </button>
          <span className="text-text-dim">
            {props.probeCount} probes run on submit. Check is static only and unlimited.
          </span>
        </div>

        <div className="max-h-[38%] overflow-y-auto border-t border-border p-3">
          {notice ? <p className="text-warn">{notice}</p> : null}
          {checked && !view ? <CheckSummary gate={gate} /> : null}
          {view ? <Result view={view} /> : null}
          {!checked && !view && !notice ? (
            <p className="text-text-dim">
              Edit the prompt, then Check to run the static rules. Submit runs the probes.
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function Checklist({ title, checks }: {
  title: string; checks: StaticGate["checks"];
}) {
  if (!checks.length) return null;
  return (
    <section className="border-b border-border p-3">
      <h2 className="mb-2 text-text-dim">{title}</h2>
      <ul className="space-y-1">
        {checks.map((check) => (
          <li key={check.label} className="flex gap-2">
            <span aria-hidden className={check.status === "pass" ? "text-accent" : "text-text-dim"}>
              {check.status === "pass" ? "[x]" : "[ ]"}
            </span>
            <span>
              <span className={check.status === "pass" ? "" : "text-text"}>{check.label}</span>
              {check.status === "fail" && check.message ? (
                <span className="block text-text-dim">{check.message}</span>
              ) : null}
              <span className="sr-only">{check.status === "pass" ? "passing" : "failing"}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CheckSummary({ gate }: { gate: StaticGate }) {
  const failing = gate.checks.filter((c) => c.status === "fail");
  if (!failing.length) {
    return <p>Every static rule passes. Submit to run the probes.</p>;
  }
  return (
    <div>
      <h3 className="mb-2">Checks</h3>
      <ul className="space-y-1">
        {failing.map((check) => (
          <li key={check.label} className="text-text-dim">
            <span className="text-text">{check.label}</span>: {check.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DiffPane({ lines }: { lines: ReturnType<typeof diffLines> }) {
  return (
    <pre className="p-3 text-[13px] leading-6">
      {lines.map((line, index) => (
        <div key={index}
             className={line.kind === "added" ? "text-accent"
               : line.kind === "removed" ? "text-text-dim line-through" : ""}>
          <span className="tnum mr-3 inline-block w-10 text-right text-text-dim">
            {line.originalLine ?? line.editedLine ?? ""}
          </span>
          <span aria-hidden className="mr-2">
            {line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " "}
          </span>
          {line.text || " "}
        </div>
      ))}
    </pre>
  );
}

function Result({ view }: { view: import("@/lib/submissions/view").SubmissionView }) {
  if (view.status !== "terminal") return <p className="text-text-dim">Judging.</p>;
  if (view.verdict === "error") {
    return <p className="text-warn">{view.message ?? "The judge did not complete."}</p>;
  }

  return (
    <div className="space-y-3">
      {view.correction ? (
        <section className="rounded border border-accent px-3 py-2">
          <h3 className="mb-1 text-accent">
            {view.correction.direction === "raised"
              ? "A reviewer raised this grade"
              : "A reviewer lowered this grade"}
          </h3>
          <p className="text-text-dim">{view.correction.note}</p>
          <p className="mt-1 text-text-faint">
            Your cohort lead can take this up if you think it is wrong.
          </p>
        </section>
      ) : null}

      <p>
        <span className="capitalize">{view.verdict}</span>
        {view.score === null ? null : <span className="tnum"> at {view.score}</span>}
      </p>

      {view.checks.some((c) => c.status === "fail") ? (
        <section>
          <h3 className="mb-1 text-text-dim">Static rules</h3>
          <ul>
            {view.checks.filter((c) => c.status === "fail").map((check) => (
              <li key={check.label}>{check.label}: {check.message}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {view.probes.total ? (
        <section>
          <h3 className="mb-1 text-text-dim">
            Probes <span className="tnum">{view.probes.passed} of {view.probes.total}</span>
          </h3>
          <ul className="space-y-1">
            {view.probes.cases.map((probe) => (
              <li key={probe.name}>
                <span className={probe.status === "pass" ? "text-accent" : "text-warn"}>
                  {probe.status === "pass" ? "pass" : "fail"}
                </span>{" "}
                {probe.name.replace(/_/g, " ")}
                <span className="text-text-dim"> must {probe.assertionType}</span>
                {probe.userMessage ? (
                  <span className="block text-text-dim">asked: {probe.userMessage}</span>
                ) : null}
              </li>
            ))}
          </ul>
          {view.probes.cases.some((p) => p.userMessage === null) ? (
            <p className="mt-1 text-text-dim">
              The probe wording opens once you pass this problem.
            </p>
          ) : null}
        </section>
      ) : null}

      {view.rubric.criteria.length ? (
        <section>
          <h3 className="mb-1 text-text-dim">Rubric</h3>
          <ul className="space-y-1">
            {view.rubric.criteria.map((criterion) => (
              <li key={criterion.label}>
                <span className="tnum">{criterion.score}/{criterion.weight}</span>{" "}
                {criterion.label}
                <span className="block text-text-dim">{criterion.evidenceQuote}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
