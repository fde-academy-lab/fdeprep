"use client";

/**
 * Screen S5, the prompt surgery workspace.
 *
 * Three editor modes, and a checklist that updates as the learner types. The
 * checklist runs lib/gate, the same module the server runs on submit, so what
 * it shows and what the submit gate decides cannot disagree. Nothing here
 * calls the network on a keystroke except the coach, which waits for a pause
 * and reads the text with the problem's own patterns, never with a model.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView } from "@codemirror/view";
import { CheckCheck, Send } from "lucide-react";
import { diffCounts, diffLines } from "@/lib/diff";
import { evaluatePromptRules, type PromptRule, type StaticGate } from "@/lib/gate";
import type { Decision } from "@/lib/policy";
import type { PaletteProblem } from "@/lib/problems/catalogue";
import type { AttemptHistory, PastSubmission, WorkspaceProblem } from "@/lib/problems/workspace";
import type { PalettePage } from "@/components/shell/command-palette";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/ui/markdown";
import { StatusIcon } from "@/components/ui/status";
import { cn } from "@/components/ui/cn";
import { ProblemBar } from "@/components/workspace/problem-bar";
import { WorkspaceLayout } from "@/components/workspace/layout";
import { editorTheme } from "@/components/workspace/editor-theme";
import { CoachBar, useCoach } from "@/components/workspace/coach";
import { JudgedResults, LocalChecks } from "@/components/workspace/judged-results";
import {
  AttemptsPanel, GuidePanel, NoteBox, PaneTabs, ProblemIntro, Section, type PaneTab,
} from "@/components/workspace/panels";
import { submitsLeft } from "./submits-left";
import { useSubmission } from "./use-submission";

interface Props {
  problem: WorkspaceProblem;
  policy: Decision;
  history: AttemptHistory;
  palette: PaletteProblem[];
  pages: PalettePage[];
  rehearsalId: number | null;
}

type Mode = "original" | "edited" | "diff";

const DEBOUNCE_MS = 120;

export default function PromptWorkspace(props: Props) {
  const { problem } = props;
  const original = problem.originalPrompt ?? "";
  const rules = problem.promptRules as PromptRule[];
  const [policy, setPolicy] = useState(props.policy);
  const [prompt, setPrompt] = useState(original);
  const [mode, setMode] = useState<Mode>("edited");
  const [touched, setTouched] = useState(false);
  const [checked, setChecked] = useState(false);
  const [tab, setTab] = useState<PaneTab>("brief");
  const [hints, setHints] = useState(props.history.hints);
  const [note, setNote] = useState(props.history.note);
  const [busy, setBusy] = useState(false);
  const [gateNotice, setGateNotice] = useState<string | null>(null);
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

  useEffect(() => {
    if (!view || view.status !== "terminal") return;
    setPast((prior) => [{
      id: view.id, kind: view.kind, verdict: view.verdict, score: view.score, queuedAt: view.queuedAt,
      publicPassed: null, publicTotal: null, hiddenPassed: null, hiddenTotal: null, llmCalls: null,
    }, ...prior.filter((s) => s.id !== view.id)]);
  }, [view]);

  const storageKey = `fdeprep.prompt.${problem.id}`;
  useEffect(() => {
    try {
      const draft = localStorage.getItem(storageKey);
      if (draft) { setPrompt(draft); setTouched(true); setMode("diff"); }
    } catch { /* a browser with storage blocked still gets a workspace */ }
  }, [storageKey]);

  const onChange = useCallback((next: string) => {
    setPrompt(next);
    setChecked(false);
    if (!touched) setTouched(true);
    try { localStorage.setItem(storageKey, next); } catch { /* blocked */ }
  }, [storageKey, touched]);

  const [settled, setSettled] = useState(original);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(prompt), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [prompt]);

  const gate: StaticGate = useMemo(() => evaluatePromptRules(settled, rules), [settled, rules]);
  const diff = useMemo(() => diffLines(original, settled), [original, settled]);
  const counts = useMemo(() => diffCounts(diff), [diff]);

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
    } finally { setBusy(false); }
  }, [problem.id, refreshPolicy]);

  const submit = useCallback(() => {
    if (running || !policy.submit.allowed) return;
    if (policy.confirmBeforeSubmit && !confirm(props.rehearsalId
      ? "One submit per problem in a rehearsal. Submit this one?"
      : "This is your only submit today on an Extreme problem. Submit it?")) return;
    void send("submit", prompt, { rehearsalId: props.rehearsalId });
  }, [running, policy.submit.allowed, policy.confirmBeforeSubmit, props.rehearsalId, send, prompt]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key !== "Enter") return;
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) submit(); else setChecked(true);
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [submit]);

  const coach = useCoach({ problemId: problem.id, enabled: policy.coach.enabled, text: prompt, settledKey });
  const hintGate = policy.layers.hints ? policy.hints : null;
  const extensions = useMemo(() => [...editorTheme, EditorView.lineWrapping], []);

  const mustRemove = gate.checks.filter((c) => c.kind === "must_remove");
  const mustKeep = gate.checks.filter((c) => c.kind !== "must_remove");

  const left = (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <PaneTabs tab={tab} onTab={setTab} attemptCount={past.length}
                hintBadge={hintGate && hintGate.total ? `${hintGate.revealed}/${hintGate.total}` : null} />
      <div className="relative min-h-0 flex-1 overflow-y-auto">
        {tab === "brief" ? (
          <ProblemIntro title={problem.title} track={problem.track} difficulty={problem.difficulty}
                        estMinutes={problem.estMinutes} artefactLabel="Prompt surgery"
                        kit={problem.kit} briefMd={problem.briefMd}>
            {problem.contractMd ? (
              <Section title="What counts as done"><Markdown source={problem.contractMd} /></Section>
            ) : null}
            <Section title="Checklist" aside="Updates as you type">
              <Checklist title="Must go" checks={mustRemove} />
              <Checklist title="Must survive" checks={mustKeep} />
              <p className="text-meta text-text-faint">
                {problem.probeCount} probes run on Submit. They send customer messages to your
                edited prompt and read the replies.
              </p>
            </Section>
            {problem.referenceMd ? (
              <Section title="Walkthrough"><Markdown source={problem.referenceMd} /></Section>
            ) : null}
          </ProblemIntro>
        ) : tab === "guide" ? (
          <GuidePanel kit={problem.kit} hintGate={hintGate} hints={hints} busy={busy}
                      onReveal={() => void act("hints", { method: "POST" }).then((h) => {
                        if (h) setHints((prior) => [...prior, h as { ordinal: number; bodyMd: string }]);
                      })}
                      noteSlot={policy.attemptNote.required ? (
                        <NoteBox note={note} setNote={setNote}
                                 required={policy.attemptNote.chars + policy.attemptNote.needed}
                                 onSave={() => void act("note", {
                                   method: "PUT", headers: { "content-type": "application/json" },
                                   body: JSON.stringify({ note }),
                                 })} />
                      ) : null}
                      coachLog={policy.coach.enabled ? coach.log : null}
                      giveUp={policy.giveUp}
                      onGiveUp={() => {
                        if (!confirm("Give up on this problem? The walkthrough opens and the choice is recorded on your attempt.")) return;
                        void act("give-up", {
                          method: "POST", headers: { "content-type": "application/json" },
                          body: JSON.stringify({ reason: note || null }),
                        }).then(() => setTab("brief"));
                      }} />
        ) : (
          <AttemptsPanel submissions={past} />
        )}
        {gateNotice ? (
          <p role="alert" className="mx-5 mb-6 rounded-control border border-warn/40 bg-warn-soft px-3 py-2 text-text">
            {gateNotice}
          </p>
        ) : null}
      </div>
    </div>
  );

  const editor = (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <div className="flex h-10 shrink-0 items-end justify-between border-b border-border pl-2 pr-3">
        <div role="tablist" aria-label="Editor mode" className="flex items-end">
          {(["original", "edited", "diff"] as Mode[]).map((name) => (
            <button key={name} type="button" role="tab" aria-selected={mode === name}
                    onClick={() => setMode(name)}
                    className={cn("-mb-px h-9 border-b-2 px-3 font-medium capitalize",
                                  mode === name ? "border-text-faint text-text"
                                    : "border-transparent text-text-dim hover:text-text")}>
              {name}
            </button>
          ))}
        </div>
        <span className="tnum pb-2 text-meta text-text-faint">
          <span className="text-pass">+{counts.added}</span>{" "}
          <span className="text-fail">-{counts.removed}</span> lines
        </span>
      </div>
      <div className="relative min-h-0 flex-1 overflow-auto">
        {mode === "original" ? (
          <pre className="whitespace-pre-wrap p-4 font-mono text-[13px] leading-[1.65] text-text-dim">
            {original}
          </pre>
        ) : mode === "edited" ? (
          <CodeMirror value={prompt} height="100%" onChange={onChange} theme="none"
                      extensions={extensions} aria-label="The system prompt"
                      basicSetup={{ lineNumbers: true, foldGutter: false, autocompletion: false,
                                    highlightActiveLine: true }}
                      className="h-full" />
        ) : (
          <DiffPane lines={diff} />
        )}
      </div>
    </div>
  );

  const dock = (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <CoachBar current={coach.current} wrapUp={coach.wrapUp} opening={problem.kit.coachOpening}
                enabled={policy.coach.enabled} onDismiss={coach.dismiss}
                onHint={hintGate ? () => setTab("guide") : undefined} hintLabel="Guide"
                idleText="Nothing to flag. Check runs the rules; Submit sends the probes." />
      <div className="relative min-h-0 flex-1 overflow-y-auto">
        {checked && !view && !running ? (
          <div className="results-pane p-4"><LocalChecks checks={gate.checks} title="rules" /></div>
        ) : (
          <JudgedResults view={view} running={running} notice={notice} idle={
            <p className="text-text-dim">
              Check runs the static rules here, instantly and as often as you like. Submit runs
              the rules, then {problem.probeCount} probes against your prompt, then the rubric judge.
            </p>
          } />
        )}
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
            <Button variant="secondary" onClick={() => setChecked(true)} title="Run the static rules (Cmd Enter)">
              <CheckCheck aria-hidden /> Check
            </Button>
            <Button variant="primary" onClick={submit} disabled={running || !policy.submit.allowed}
                    title={policy.submit.reason ?? "Submit for grading (Cmd Shift Enter)"}>
              <Send aria-hidden /> {running ? "Judging" : "Submit"}
            </Button>
          </>
        }
      />
      <WorkspaceLayout storageKey={`fdeprep.split.${problem.id}`} left={left} editor={editor}
                       dock={dock} editorLabel="Prompt" editorShare={60}
                       dockSignal={`${view?.id ?? ""}:${view?.status ?? ""}:${coach.current?.say ?? ""}:${notice ?? ""}`} />
    </div>
  );
}

function Checklist({ title, checks }: { title: string; checks: StaticGate["checks"] }) {
  if (!checks.length) return null;
  return (
    <div>
      <p className="mb-1.5 text-meta font-medium text-text-faint">{title}</p>
      <ul className="space-y-1">
        {checks.map((check) => (
          <li key={check.label} className="flex items-start gap-2.5 rounded-control px-1 py-1">
            <StatusIcon kind={check.status === "pass" ? "pass" : "untouched"} className="mt-0.5"
                        label={check.status === "pass" ? "Done" : "Not yet"} />
            <span className={check.status === "pass" ? "text-text-dim" : "text-text"}>
              {check.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DiffPane({ lines }: { lines: ReturnType<typeof diffLines> }) {
  return (
    <pre className="py-3 font-mono text-[13px] leading-[1.65]">
      {lines.map((line, index) => (
        <div key={index}
             className={cn("flex pr-4",
                           line.kind === "added" ? "bg-pass-soft text-text"
                             : line.kind === "removed" ? "bg-fail-soft text-text-dim line-through decoration-fail/60"
                             : "text-text-dim")}>
          <span className="tnum inline-block w-12 shrink-0 select-none pr-3 text-right text-text-faint">
            {line.originalLine ?? line.editedLine ?? ""}
          </span>
          <span aria-hidden className={cn("w-4 shrink-0 select-none",
                                          line.kind === "added" ? "text-pass" : line.kind === "removed" ? "text-fail" : "")}>
            {line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " "}
          </span>
          <span className="whitespace-pre-wrap">{line.text || " "}</span>
        </div>
      ))}
    </pre>
  );
}
