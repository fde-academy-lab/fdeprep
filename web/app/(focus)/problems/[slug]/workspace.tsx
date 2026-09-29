"use client";

/**
 * Screen S4, the code workspace.
 *
 * Left: the problem, as a situation, a picture and a brief, with the guide and
 * the attempt history a tab away. Right: the editor, the coach underneath it,
 * and the results of the last run. The policy decides every gate; this file
 * draws what it is told and asks again after anything that can move a gate.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { python } from "@codemirror/lang-python";
import { Play, RotateCcw, Send } from "lucide-react";
import type { Decision } from "@/lib/policy";
import type { PaletteProblem } from "@/lib/problems/catalogue";
import type { AttemptHistory, PastSubmission, WorkspaceProblem } from "@/lib/problems/workspace";
import type { PalettePage } from "@/components/shell/command-palette";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Markdown } from "@/components/ui/markdown";
import { cn } from "@/components/ui/cn";
import { ProblemBar } from "@/components/workspace/problem-bar";
import { Split } from "@/components/workspace/split";
import { editorTheme } from "@/components/workspace/editor-theme";
import { CoachBar, useCoach } from "@/components/workspace/coach";
import { CodeResults } from "@/components/workspace/code-results";
import {
  AttemptsPanel, GuidePanel, NoteBox, PaneTabs, ProblemIntro, Section, type PaneTab,
} from "@/components/workspace/panels";
import Defence from "./defence";
import { submitsLeft } from "./submits-left";
import { useSubmission } from "./use-submission";

interface Props {
  problem: WorkspaceProblem;
  policy: Decision;
  history: AttemptHistory;
  palette: PaletteProblem[];
  pages: PalettePage[];
  /** Set when this workspace was opened from a rehearsal sitting. */
  rehearsalId: number | null;
}

export default function Workspace(props: Props) {
  const { problem } = props;
  const [policy, setPolicy] = useState<Decision>(props.policy);
  const [hints, setHints] = useState(props.history.hints);
  const [note, setNote] = useState(props.history.note);
  const [learnerTest, setLearnerTest] = useState("");
  const [gateNotice, setGateNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<PaneTab>("brief");
  const [code, setCode] = useState(problem.stubCode ?? "");
  const [settledKey, setSettledKey] = useState(0);
  const [past, setPast] = useState<PastSubmission[]>(props.history.submissions);

  const refreshPolicy = useCallback(async () => {
    const response = await fetch(`/api/problems/${problem.id}/policy`);
    if (response.ok) setPolicy((await response.json()) as Decision);
  }, [problem.id]);

  const onSettled = useCallback(async () => {
    setSettledKey((k) => k + 1);
    await refreshPolicy();
  }, [refreshPolicy]);

  const { view, running, notice, send } = useSubmission(problem.id, onSettled);

  // Keep the attempts tab current without a reload.
  useEffect(() => {
    if (!view || view.status !== "terminal") return;
    setPast((prior) => [{
      id: view.id, kind: view.kind, verdict: view.verdict, score: view.score,
      queuedAt: view.queuedAt,
      publicPassed: view.gates.public.passed, publicTotal: view.gates.public.total,
      hiddenPassed: view.gates.hidden.total ? view.gates.hidden.passed : null,
      hiddenTotal: view.gates.hidden.total || null,
      llmCalls: view.modelCalls,
    }, ...prior.filter((s) => s.id !== view.id)]);
  }, [view]);

  const act = useCallback(async (path: string, init?: RequestInit) => {
    setGateNotice(null);
    setBusy(true);
    try {
      const response = await fetch(`/api/problems/${problem.id}/${path}`, init);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setGateNotice((payload as { message?: string }).message ?? "That did not go through. Try again.");
        return null;
      }
      await refreshPolicy();
      return payload;
    } finally {
      setBusy(false);
    }
  }, [problem.id, refreshPolicy]);

  const storageKey = `fdeprep.split.${problem.id}`;
  useEffect(() => {
    try {
      const draft = localStorage.getItem(`${storageKey}.code`);
      if (draft) setCode(draft);
    } catch { /* a browser with storage blocked still gets a working workspace */ }
  }, [storageKey]);

  const onCodeChange = useCallback((next: string) => {
    setCode(next);
    try { localStorage.setItem(`${storageKey}.code`, next); } catch { /* blocked */ }
  }, [storageKey]);

  const run = useCallback(() => {
    if (running || !policy.run.allowed) return;
    void send("run", code, { rehearsalId: props.rehearsalId });
  }, [running, policy.run.allowed, send, code, props.rehearsalId]);

  const submit = useCallback(() => {
    if (running || !policy.submit.allowed) return;
    if (policy.confirmBeforeSubmit && !confirm(props.rehearsalId
      ? "One submit per problem in a rehearsal. Submit this one?"
      : "This is your only submit today on an Extreme problem. Submit it?")) return;
    void send("submit", code, { rehearsalId: props.rehearsalId });
  }, [running, policy.submit.allowed, policy.confirmBeforeSubmit, send, code, props.rehearsalId]);

  // Cmd or Ctrl Enter runs, with Shift it submits. Captured before the editor
  // sees it, since CodeMirror binds Mod-Enter to inserting a blank line.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key !== "Enter") return;
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) submit(); else run();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [run, submit]);

  const coach = useCoach({
    problemId: problem.id, enabled: policy.coach.enabled, text: code, settledKey,
  });

  const reveal = () => void act("hints", { method: "POST" }).then((hint) => {
    if (hint) setHints((prior) => [...prior, hint as { ordinal: number; bodyMd: string }]);
  });

  const hintGate = policy.layers.hints ? policy.hints : null;
  const extensions = useMemo(() => [python(), ...editorTheme], []);

  const left = (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <PaneTabs tab={tab} onTab={setTab} attemptCount={past.length}
                hintBadge={hintGate && hintGate.total ? `${hintGate.revealed}/${hintGate.total}` : null} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "brief" ? (
          <ProblemIntro title={problem.title} track={problem.track} difficulty={problem.difficulty}
                        estMinutes={problem.estMinutes} artefactLabel="Python"
                        kit={problem.kit} briefMd={problem.briefMd}>
            {problem.contractMd ? (
              <Section title="Contract" aside={problem.callBudget
                ? `${problem.callBudget} model calls` : null}>
                <Markdown source={problem.contractMd} />
                {problem.allowedImports.length ? (
                  <p className="text-meta text-text-dim">
                    Allowed imports:{" "}
                    {problem.allowedImports.map((name, i) => (
                      <span key={name}>
                        {i ? ", " : ""}<code className="font-mono text-text">{name}</code>
                      </span>
                    ))}
                  </p>
                ) : null}
              </Section>
            ) : null}

            {problem.steps.length ? <Steps problemId={problem.id} steps={problem.steps} /> : null}

            {policy.learnerTests.required ? (
              <Section title="Write your tests first"
                       aside={policy.learnerTests.withAssertion ? "Saved with an assertion" : null}>
                <p className="text-text-dim">
                  On Extreme the tests come first. Submit stays closed until one of them contains an
                  assertion.
                </p>
                <textarea value={learnerTest} onChange={(e) => setLearnerTest(e.target.value)}
                          rows={6} aria-label="Your test" spellCheck={false}
                          className="w-full rounded-control border border-border-control bg-surface
                                     p-3 font-mono text-meta leading-relaxed text-text outline-none
                                     focus:border-accent" />
                <Button size="sm" disabled={busy || !learnerTest.trim()}
                        onClick={() => void act("learner-tests", {
                          method: "POST", headers: { "content-type": "application/json" },
                          body: JSON.stringify({ body: learnerTest }),
                        }).then((ok) => { if (ok) setLearnerTest(""); })}>
                  Save this test
                </Button>
              </Section>
            ) : null}

            {problem.defenceQuestion ? (
              <Defence problemId={problem.id} defence={policy.defence}
                       question={problem.defenceQuestion} onSettled={refreshPolicy} />
            ) : null}

            {policy.layers.reference && problem.referenceMd ? (
              <Section title="Walkthrough">
                <Markdown source={problem.referenceMd} />
              </Section>
            ) : null}
          </ProblemIntro>
        ) : tab === "guide" ? (
          <GuidePanel
            kit={problem.kit} hintGate={hintGate} hints={hints} onReveal={reveal} busy={busy}
            coachLog={policy.coach.enabled ? coach.log : null}
            noteSlot={policy.attemptNote.required ? (
              <NoteBox note={note} setNote={setNote}
                       required={policy.attemptNote.chars + policy.attemptNote.needed}
                       onSave={() => void act("note", {
                         method: "PUT", headers: { "content-type": "application/json" },
                         body: JSON.stringify({ note }),
                       })} />
            ) : null}
            giveUp={policy.giveUp}
            onGiveUp={() => {
              if (!confirm("Give up on this problem? The walkthrough opens and the choice is " +
                           "recorded on your attempt.")) return;
              void act("give-up", {
                method: "POST", headers: { "content-type": "application/json" },
                body: JSON.stringify({ reason: note || null }),
              }).then(() => setTab("brief"));
            }}
          />
        ) : (
          <AttemptsPanel submissions={past} />
        )}
        {gateNotice ? (
          <p role="alert" className="mx-5 mb-6 rounded-control border border-warn/40 bg-warn-soft
                                     px-3 py-2 text-text">{gateNotice}</p>
        ) : null}
      </div>
    </div>
  );

  const editor = (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <div className="flex h-10 shrink-0 items-end justify-between border-b border-border pl-2 pr-3">
        <span className="-mb-px inline-flex h-9 items-center gap-2 border-b-2 border-text-faint px-2.5
                         font-mono text-meta text-text">
          solution.py
        </span>
        <div className="flex items-center gap-3 pb-1.5 text-meta text-text-faint">
          <span className="hidden md:inline">Python 3.12</span>
          <button type="button" title="Put the starter code back"
                  onClick={() => {
                    if (confirm("Replace your code with the starter code? Your draft is lost.")) {
                      onCodeChange(problem.stubCode ?? "");
                    }
                  }}
                  className="inline-flex items-center gap-1 rounded-control px-1.5 py-1 hover:bg-surface-2
                             hover:text-text">
            <RotateCcw aria-hidden className="size-3.5" /> Reset
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <CodeMirror value={code} onChange={onCodeChange} height="100%" theme="none"
                    extensions={extensions} aria-label="Your solution"
                    // docs/01 S4: tab size four, soft wrap off, which is the default.
                    basicSetup={{ autocompletion: false, tabSize: 4, highlightActiveLine: true,
                                  foldGutter: true, bracketMatching: true }}
                    className="h-full" />
      </div>
    </div>
  );

  const dock = (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <CoachBar current={coach.current} wrapUp={coach.wrapUp} opening={problem.kit.coachOpening}
                enabled={policy.coach.enabled} onDismiss={coach.dismiss}
                onHint={hintGate ? () => setTab("guide") : undefined}
                hintLabel="Guide"
                idleText="Nothing to flag. Press Cmd Enter to run the public tests." />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <CodeResults view={view} running={running} notice={notice}
                     visibility={policy.visibility} callBudget={problem.callBudget} />
      </div>
    </div>
  );

  return (
    <div className="flex h-dvh flex-col">
      <ProblemBar
        title={problem.title} track={problem.track} difficulty={problem.difficulty}
        palette={props.palette} pages={props.pages}
        status={submitsLeft(policy)}
        actions={
          <>
            <Button variant="secondary" onClick={run} disabled={running || !policy.run.allowed}
                    title={policy.run.reason ?? "Run the public tests (Cmd Enter)"}>
              <Play aria-hidden /> {running ? "Running" : "Run"}
              <Kbd className="hidden lg:inline-flex">⌘↵</Kbd>
            </Button>
            <Button variant="primary" onClick={submit} disabled={running || !policy.submit.allowed}
                    title={policy.submit.reason ?? "Submit for grading (Cmd Shift Enter)"}>
              <Send aria-hidden /> Submit
            </Button>
          </>
        }
      />
      {!policy.submit.allowed && policy.submit.reason ? (
        <p className="shrink-0 border-b border-border bg-surface px-4 py-1.5 text-meta text-text-dim">
          {policy.submit.reason}
        </p>
      ) : null}
      <Split direction="row" storageKey={`${storageKey}.left`} initial={42} min={26} max={62}
             label="Resize the problem pane" className="min-h-0 flex-1"
             first={left}
             second={
               <Split direction="column" storageKey={`${storageKey}.editor`} initial={58} min={25}
                      max={85} label="Resize the editor" className="h-full"
                      first={editor} second={dock} />
             } />
    </div>
  );
}

function Steps({ problemId, steps }: { problemId: number; steps: Array<{ id: string; text: string }> }) {
  const key = `fdeprep.steps.${problemId}`;
  const [done, setDone] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const saved = localStorage.getItem(key);
      if (saved) setDone(new Set(JSON.parse(saved) as string[]));
    } catch { /* blocked */ }
  }, [key]);
  const toggle = (id: string) => setDone((prior) => {
    const next = new Set(prior);
    if (next.has(id)) next.delete(id); else next.add(id);
    try { localStorage.setItem(key, JSON.stringify([...next])); } catch { /* blocked */ }
    return next;
  });
  return (
    <Section title="Steps" aside={`${done.size} of ${steps.length} ticked`}>
      <ol className="space-y-1.5">
        {steps.map((step, index) => (
          <li key={step.id}>
            <label className="flex cursor-pointer items-start gap-3 rounded-control px-2 py-1.5
                              hover:bg-surface">
              <input type="checkbox" checked={done.has(step.id)} onChange={() => toggle(step.id)}
                     className="mt-1 size-4 shrink-0 accent-[var(--color-accent)]" />
              <span className={cn(done.has(step.id) ? "text-text-dim line-through" : "text-text")}>
                <span className="mr-2 font-mono text-meta text-text-faint">{index + 1}</span>
                {step.text}
              </span>
            </label>
          </li>
        ))}
      </ol>
    </Section>
  );
}
