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
import { Check, Play, RotateCcw, Send } from "lucide-react";
import type { Decision } from "@/lib/policy";
import type { PaletteProblem } from "@/lib/problems/catalogue";
import type { AttemptHistory, PastSubmission, WorkspaceProblem } from "@/lib/problems/workspace";
import type { StepView } from "@/lib/submissions/view";
import type { PalettePage } from "@/components/shell/command-palette";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Markdown } from "@/components/ui/markdown";
import { cn } from "@/components/ui/cn";
import { ProblemBar } from "@/components/workspace/problem-bar";
import { WorkspaceLayout } from "@/components/workspace/layout";
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
  const [stepStatus, setStepStatus] = useState<StepView[]>(props.history.steps);

  const refreshPolicy = useCallback(async () => {
    const response = await fetch(`/api/problems/${problem.id}/policy`);
    if (response.ok) setPolicy((await response.json()) as Decision);
  }, [problem.id]);

  const onSettled = useCallback(async () => {
    setSettledKey((k) => k + 1);
    await refreshPolicy();
  }, [refreshPolicy]);

  const { view, running, notice, send } = useSubmission(problem.id, onSettled);

  // Keep the attempts tab and the checklist current without a reload.
  useEffect(() => {
    if (!view || view.status !== "terminal") return;
    if (view.kind === "run" || view.kind === "submit") setStepStatus(view.steps);
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
      <div className="relative min-h-0 flex-1 overflow-y-auto">
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

            {problem.steps.length ? <Steps steps={problem.steps} status={stepStatus} /> : null}

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
      <div className="relative min-h-0 flex-1 overflow-y-auto">
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
      <WorkspaceLayout storageKey={`fdeprep.split.${problem.id}`} left={left} editor={editor}
                       dock={dock} editorLabel="Code" editorShare={58}
                       dockSignal={`${view?.id ?? ""}:${view?.status ?? ""}:${coach.current?.say ?? ""}:${notice ?? ""}`} />
    </div>
  );
}

/**
 * docs/01 S4: each step has its own check, run on every Run against the public
 * tests, and turns green on its own. The status comes from the last run's
 * result, so the list shows what the code did rather than what the learner
 * ticked.
 */
function Steps({ steps, status }: {
  steps: Array<{ id: string; text: string }>;
  status: StepView[];
}) {
  const byId = new Map(status.map((s) => [s.id, s.status]));
  const green = steps.filter((step) => byId.get(step.id) === "pass").length;
  const checkable = steps.filter((step) => byId.get(step.id) !== "unchecked").length;
  const aside = status.length
    ? `${green} of ${checkable} checked steps green on the last run`
    : "Run to check each step";
  return (
    <Section title="Steps" aside={aside}>
      <ol className="space-y-0.5">
        {steps.map((step, index) => {
          const state = byId.get(step.id);
          return (
            <li key={step.id} className="flex items-start gap-3 rounded-control px-2 py-1.5"
                title={state === "unchecked"
                  ? "This step's check passes on the starter code too, so it cannot tell " +
                    "your work from none. Check it against the brief yourself." : undefined}>
              <span aria-hidden
                    className={cn("mt-px grid size-5 shrink-0 place-items-center rounded-full border",
                                  "font-mono text-[11px] leading-none",
                                  state === "pass" ? "border-pass/50 bg-pass-soft text-pass"
                                    : state === "unchecked" ? "border-dashed border-border-strong text-text-faint"
                                    : "border-border-strong text-text-faint")}>
                {state === "pass" ? <Check className="size-3" strokeWidth={2.5} /> : index + 1}
              </span>
              <span className={state === "pass" ? "text-text-dim" : "text-text"}>
                {step.text}
                {state === "unchecked" ? (
                  <span className="mt-0.5 block text-meta text-text-faint">
                    Its check passes on the starter code too. Check this one against the brief.
                  </span>
                ) : null}
                <span className="sr-only">
                  {state === "pass" ? ", done on the last run"
                    : state === "fail" ? ", not done on the last run"
                    : state === "unchecked" ? "" : ", not checked yet"}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </Section>
  );
}
