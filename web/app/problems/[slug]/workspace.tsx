"use client";

/**
 * The three-pane workspace. Panes are resizable and the split is stored per
 * account, which in Phase 2 means localStorage until sign-in lands in Phase 5.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { python } from "@codemirror/lang-python";
import type { SubmissionView } from "@/lib/submissions/view";

interface Props {
  problemId: number;
  title: string;
  briefMd: string;
  contractMd: string | null;
  stubCode: string;
  steps: Array<{ id: string; text: string }>;
  callBudget: number | null;
  allowedImports: string[];
  hintCount: number;
  hintLabel: string;
  showsHiddenCount: boolean;
  confirmBeforeSubmit: boolean;
}

type Tab = "problem" | "attempts" | "trace";

const MIN_LEFT = 22;
const MAX_LEFT = 60;
const MIN_EDITOR = 25;

export default function Workspace(props: Props) {
  const storageKey = `fdeprep.split.${props.problemId}`;
  const [leftWidth, setLeftWidth] = useState(34);
  const [editorHeight, setEditorHeight] = useState(55);
  const [tab, setTab] = useState<Tab>("problem");
  const [code, setCode] = useState(props.stubCode);
  const [running, setRunning] = useState(false);
  const [view, setView] = useState<SubmissionView | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const streamRef = useRef<EventSource | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved) as { left?: number; editor?: number };
        if (parsed.left) setLeftWidth(parsed.left);
        if (parsed.editor) setEditorHeight(parsed.editor);
      }
      const draft = localStorage.getItem(`${storageKey}.code`);
      if (draft) setCode(draft);
    } catch {
      // A browser with storage blocked still gets a working workspace.
    }
  }, [storageKey]);

  const persist = useCallback((left: number, editor: number) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ left, editor }));
    } catch { /* storage blocked */ }
  }, [storageKey]);

  const onCodeChange = useCallback((next: string) => {
    setCode(next);
    try { localStorage.setItem(`${storageKey}.code`, next); } catch { /* blocked */ }
  }, [storageKey]);

  const dragVertical = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => {
      const next = Math.min(MAX_LEFT, Math.max(MIN_LEFT, (e.clientX / window.innerWidth) * 100));
      setLeftWidth(next);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setLeftWidth((l) => { persist(l, editorHeight); return l; });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const dragHorizontal = (event: React.PointerEvent<HTMLDivElement>) => {
    const container = event.currentTarget.parentElement;
    if (!container) return;
    const bounds = container.getBoundingClientRect();
    const move = (e: PointerEvent) => {
      const next = Math.min(85, Math.max(MIN_EDITOR, ((e.clientY - bounds.top) / bounds.height) * 100));
      setEditorHeight(next);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setEditorHeight((h) => { persist(leftWidth, h); return h; });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const submit = async (kind: "run" | "submit") => {
    if (kind === "submit" && props.confirmBeforeSubmit &&
        !confirm("This is your only attempt today on an Extreme problem. Submit it?")) return;

    setRunning(true);
    setNotice(null);
    setView(null);
    streamRef.current?.close();

    const response = await fetch("/api/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ problemId: props.problemId, kind, body: code }),
    });

    if (!response.ok) {
      const problem = (await response.json()) as { message?: string };
      setNotice(problem.message ?? "That did not go through. Try again.");
      setRunning(false);
      return;
    }

    const { id } = (await response.json()) as { id: number };
    listen(id);
  };

  /** Server-sent events, with polling as the fallback. */
  const listen = (id: number) => {
    let settled = false;
    const stop = () => { settled = true; streamRef.current?.close(); setRunning(false); };

    try {
      const stream = new EventSource(`/api/submissions/${id}/events`);
      streamRef.current = stream;
      stream.addEventListener("state", (event) => {
        setView(JSON.parse((event as MessageEvent).data) as SubmissionView);
      });
      stream.addEventListener("done", stop);
      stream.addEventListener("error", () => {
        if (!settled) { stream.close(); poll(id, stop); }
      });
    } catch {
      poll(id, stop);
    }
  };

  const poll = (id: number, stop: () => void) => {
    const timer = setInterval(async () => {
      const response = await fetch(`/api/submissions/${id}`);
      if (!response.ok) return;
      const next = (await response.json()) as SubmissionView;
      setView(next);
      if (next.status === "terminal") { clearInterval(timer); stop(); }
    }, 1000);
    setTimeout(() => clearInterval(timer), 120_000);
  };

  useEffect(() => () => streamRef.current?.close(), []);

  return (
    <div className="flex min-h-0 flex-1">
      <aside style={{ width: `${leftWidth}%` }}
             className="flex min-h-0 flex-col overflow-y-auto border-r border-border bg-surface">
        <nav className="flex gap-1 border-b border-border px-3 py-2 text-text-dim">
          {(["problem", "attempts", "trace"] as Tab[]).map((name) => (
            <button key={name} type="button" onClick={() => setTab(name)}
                    aria-current={tab === name ? "page" : undefined}
                    className={`rounded px-2 py-0.5 capitalize ${
                      tab === name ? "bg-surface-2 text-text" : "hover:text-text"}`}>
              {name}
            </button>
          ))}
        </nav>

        {tab === "problem" && (
          <div className="space-y-5 px-4 py-4">
            <Section title="Brief"><Prose text={props.briefMd} /></Section>
            {props.contractMd && <Section title="Contract"><Prose text={props.contractMd} /></Section>}
            {props.steps.length > 0 && (
              <Section title="Steps">
                <ul className="space-y-1">
                  {props.steps.map((step, index) => (
                    <li key={step.id} className="text-text-dim">
                      <span className="font-mono">[ ]</span> {index + 1} {step.text}
                    </li>
                  ))}
                </ul>
              </Section>
            )}
            <Section title="Hints">
              <button type="button" disabled={props.hintLabel !== "Reveal a hint"}
                      className="rounded border border-border px-2 py-1 text-text-dim
                                 disabled:text-text-faint">
                {props.hintLabel}{props.hintCount ? ` (${props.hintCount})` : ""}
              </button>
            </Section>
          </div>
        )}
        {tab === "attempts" && (
          <p className="px-4 py-4 text-text-dim">
            Nothing submitted yet. Run your code, then submit to record an attempt.
          </p>
        )}
        {tab === "trace" && (
          <p className="px-4 py-4 text-text-dim">
            The trace appears after a run. Run your code to see what the loop did.
          </p>
        )}
      </aside>

      <div onPointerDown={dragVertical} role="separator" aria-orientation="vertical"
           aria-label="Resize the problem pane"
           className="w-1 cursor-col-resize bg-border hover:bg-accent" />

      <section className="flex min-h-0 flex-1 flex-col">
        <div style={{ height: `${editorHeight}%` }} className="flex min-h-0 flex-col">
          <div className="flex items-baseline justify-between border-b border-border px-3 py-1
                          text-text-dim">
            <span className="font-mono">solution.py</span>
            <span>python 3.12</span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <CodeMirror
              value={code} onChange={onCodeChange} height="100%" theme="dark"
              // docs/01 S4: tab size four, soft wrap off. Soft wrap off is
              // the CodeMirror default, so it is left alone rather than set.
              extensions={[python()]}
              basicSetup={{ autocompletion: false, tabSize: 4, highlightActiveLine: true }}
            />
          </div>
          <div className="flex items-center gap-2 border-t border-border px-3 py-2">
            <button type="button" onClick={() => onCodeChange(props.stubCode)}
                    className="rounded border border-border px-3 py-1 text-text-dim hover:text-text">
              Reset
            </button>
            <button type="button" onClick={() => void submit("run")} disabled={running}
                    className="rounded border border-accent px-3 py-1 text-accent
                               disabled:border-border disabled:text-text-faint">
              {running ? "Running" : "Run"}
            </button>
            <button type="button" onClick={() => void submit("submit")} disabled={running}
                    className="ml-auto rounded border border-border px-3 py-1 text-text-dim
                               hover:text-text disabled:text-text-faint">
              Submit
            </button>
          </div>
        </div>

        <div onPointerDown={dragHorizontal} role="separator" aria-orientation="horizontal"
             aria-label="Resize the output pane"
             className="h-1 cursor-row-resize bg-border hover:bg-accent" />

        <Output view={view} running={running} notice={notice}
                showsHiddenCount={props.showsHiddenCount} />
      </section>
    </div>
  );
}

function Output({ view, running, notice, showsHiddenCount }: {
  view: SubmissionView | null; running: boolean; notice: string | null; showsHiddenCount: boolean;
}) {
  return (
    <div className="results-pane min-h-0 flex-1 overflow-y-auto px-4 py-3">
      <h2 className="text-xs uppercase tracking-wide text-text-faint">Output</h2>

      {notice && <p className="mt-2 text-warn">{notice}</p>}

      {!notice && !view && !running && (
        <p className="mt-2 text-text-dim">Run your code to see the public tests.</p>
      )}
      {!notice && running && !view && <p className="mt-2 text-info">Queued.</p>}

      {view && (
        <div className="mt-2 space-y-3">
          <p className={
            view.verdict === "pass" ? "text-pass"
            : view.verdict === null ? "text-info" : "text-fail"}>
            {summarise(view)}
          </p>

          {view.gates.static.status === "fail" && (
            <p className="text-fail">The static gate rejected this code before it ran.</p>
          )}

          <ul className="space-y-1 font-mono">
            {view.gates.public.cases.map((testCase) => (
              <li key={testCase.name}
                  className={testCase.status === "pass" ? "text-pass" : "text-fail"}>
                <span aria-hidden="true">{testCase.status === "pass" ? "v" : "x"}</span>{" "}
                {testCase.name}
                <span className="ml-2 text-text-dim">{testCase.status}</span>
                {testCase.message && (
                  <div className="ml-5 font-sans text-text-dim">{testCase.message}</div>
                )}
              </li>
            ))}
          </ul>

          {showsHiddenCount && view.gates.hidden.total > 0 && (
            <p className="text-text-dim">
              Hidden: {view.gates.hidden.passed} of {view.gates.hidden.total} passed.
              Names are shown once you pass the problem.
            </p>
          )}
          {view.gates.adversarial.total > 0 && (
            <p className="text-text-dim">
              Adversarial: {view.gates.adversarial.passed} of {view.gates.adversarial.total} passed.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function summarise(view: SubmissionView): string {
  if (view.status !== "terminal") return "Running.";
  const { passed, total } = view.gates.public;
  if (view.verdict === "rejected") return "Rejected before running. Fix the static gate first.";
  if (view.verdict === "timeout") return "Timed out. Your attempt was not counted.";
  if (view.verdict === "error") return view.message ?? "The runner failed. Your attempt was not counted.";
  return `Run complete, ${passed} of ${total} public tests pass.`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-1 text-xs uppercase tracking-wide text-text-faint">{title}</h2>
      {children}
    </section>
  );
}

function Prose({ text }: { text: string }) {
  return (
    <div className="space-y-2 text-text-dim">
      {text.trim().split(/\n{2,}/).map((paragraph, index) => (
        <p key={index} className="whitespace-pre-wrap">{paragraph}</p>
      ))}
    </div>
  );
}
