"use client";

/**
 * Screen S6, the design argument workspace.
 *
 * The answer is written like a document, not like code: proportional type, a
 * readable measure, and a word count against the declared range that runs from
 * the same module the structural gate runs on submit, so a count that reads
 * "in range" is a count the server agrees with.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ListTree, Send } from "lucide-react";
import { evaluateDesignStructure, wordCount } from "@/lib/gate";
import { answerOutline } from "@/lib/problems/outline";
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
import { CoachBar, useCoach } from "@/components/workspace/coach";
import { useDraft } from "@/components/workspace/draft";
import { JudgedResults } from "@/components/workspace/judged-results";
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

export default function DesignWorkspace(props: Props) {
  const { problem } = props;
  const [policy, setPolicy] = useState(props.policy);
  // The answer as typed lives in draft.live and in the textarea itself, out of
  // React state, so a key re-renders nothing. The word count, the structure
  // checks and the coach read `settled`, which follows it after a pause.
  const storageKey = `fdeprep.design.${problem.id}`;
  const { draft, settled, change } = useDraft(storageKey, "");
  const box = useRef<HTMLTextAreaElement>(null);
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

  // No blank page. The guided tiers (the ones with a steps layer) open on the
  // outline; the others offer it on a button; a rehearsal has neither. The
  // policy's layers decide, never the difficulty.
  const outline = useMemo(() => answerOutline({
    requiredHeadings: problem.requiredHeadings, approach: problem.kit.approach,
  }), [problem.requiredHeadings, problem.kit.approach]);
  const outlineMode = !outline ? "none"
    : policy.layers.steps ? "prefill" : policy.layers.stub ? "offer" : "none";

  /** Text from outside the textarea: a restored draft, or the outline. */
  const put = useCallback((text: string, options: { save: boolean }) => {
    draft.replace(text, options);
    if (box.current) box.current.value = text;
  }, [draft]);

  useEffect(() => {
    const saved = draft.saved();
    if (saved) { put(saved, { save: false }); return; }
    if (outlineMode === "prefill" && outline) put(outline, { save: false });
    // Only on arrival: a learner who clears the outline has chosen a blank page.
  }, [draft]);

  const words = useMemo(() => wordCount(settled), [settled]);
  const structure = useMemo(() => evaluateDesignStructure(settled, {
    word_range: problem.wordRange ?? undefined, required_headings: problem.requiredHeadings,
  }), [settled, problem.wordRange, problem.requiredHeadings]);

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
    void send("submit", draft.live, { rehearsalId: props.rehearsalId });
  }, [running, policy.submit.allowed, policy.confirmBeforeSubmit, props.rehearsalId, send, draft]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key === "Enter") {
        event.preventDefault();
        submit();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [submit]);

  const coach = useCoach({ problemId: problem.id, enabled: policy.coach.enabled, text: settled, settledKey });
  const hintGate = policy.layers.hints ? policy.hints : null;
  const headingChecks = structure.checks.filter((c) => c.kind === "required_heading");

  const left = (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <PaneTabs tab={tab} onTab={setTab} attemptCount={past.length}
                hintBadge={hintGate && hintGate.total ? `${hintGate.revealed}/${hintGate.total}` : null} />
      <div className="relative min-h-0 flex-1 overflow-y-auto">
        {tab === "brief" ? (
          <ProblemIntro title={problem.title} track={problem.track} difficulty={problem.difficulty}
                        estMinutes={problem.estMinutes} artefactLabel="Written argument"
                        kit={problem.kit} briefMd={problem.briefMd}>
            {problem.contractMd ? (
              <Section title="What is asked"><Markdown source={problem.contractMd} /></Section>
            ) : null}
            <Section title="How it is graded" aside="Weights out of 100">
              <ul className="divide-y divide-border overflow-hidden rounded-panel border border-border">
                {problem.rubric.map((criterion) => (
                  <li key={criterion.label} className="flex items-start gap-3 bg-surface px-3 py-2.5">
                    <span className="tnum w-8 shrink-0 font-mono text-text-dim">{criterion.weight}</span>
                    <span className="text-text">{criterion.label}</span>
                  </li>
                ))}
              </ul>
            </Section>
            {headingChecks.length ? (
              <Section title="Required headings">
                <ul className="space-y-1">
                  {headingChecks.map((check) => (
                    <li key={check.label} className="flex items-center gap-2.5">
                      <StatusIcon kind={check.status === "pass" ? "pass" : "untouched"} />
                      <span className={check.status === "pass" ? "text-text-dim" : "text-text"}>{check.label}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            ) : null}
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
                        <NoteBox note={note}
                                 required={policy.attemptNote.chars + policy.attemptNote.needed}
                                 onSave={(text) => {
                                   setNote(text);
                                   void act("note", {
                                     method: "PUT", headers: { "content-type": "application/json" },
                                     body: JSON.stringify({ note: text }),
                                   });
                                 }} />
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
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-4">
        <span className="font-medium text-text">Your answer</span>
        <WordMeter words={words} range={problem.wordRange} />
      </div>
      <div className="relative min-h-0 flex-1 overflow-y-auto">
        {outlineMode !== "none" && outline && !settled.trim() ? (
          <div className="mx-auto flex max-w-[72ch] items-center justify-between gap-3 px-6 pt-4">
            <p className="text-meta text-text-faint">
              The approach map, as headings to write under.
            </p>
            <Button size="sm" variant="secondary" onClick={() => put(outline, { save: true })}>
              <ListTree aria-hidden /> Start from the outline
            </Button>
          </div>
        ) : null}
        <textarea ref={box} defaultValue="" onChange={(event) => change(event.target.value)} spellCheck
                  aria-label="Your answer"
                  placeholder="Write it the way you would send it. Open on the recommendation, then the reasons."
                  className="mx-auto block h-full min-h-[320px] w-full max-w-[72ch] resize-none bg-transparent
                             px-6 py-5 text-lead leading-[1.7] text-text outline-none
                             placeholder:text-text-faint" />
      </div>
    </div>
  );

  const dock = (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <CoachBar current={coach.current} wrapUp={coach.wrapUp} opening={problem.kit.coachOpening}
                enabled={policy.coach.enabled} onDismiss={coach.dismiss}
                onHint={hintGate ? () => setTab("guide") : undefined} hintLabel="Guide"
                idleText="Nothing to flag. Submit when the argument is whole." />
      <div className="relative min-h-0 flex-1 overflow-y-auto">
        <JudgedResults view={view} running={running} notice={notice} idle={
          <p className="text-text-dim">
            Submit runs the structural checks, then the rubric judge. Each criterion comes back
            with a score and the line of your answer it was read from.
          </p>
        } />
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
          <Button variant="primary" onClick={submit} disabled={running || !policy.submit.allowed}
                  title={policy.submit.reason ?? "Submit for grading (Cmd Shift Enter)"}>
            <Send aria-hidden /> {running ? "Judging" : "Submit"}
          </Button>
        }
      />
      <WorkspaceLayout storageKey={`fdeprep.split.${problem.id}`} left={left} editor={editor}
                       dock={dock} editorLabel="Answer" editorShare={64}
                       dockSignal={`${view?.id ?? ""}:${view?.status ?? ""}:${coach.current?.say ?? ""}:${notice ?? ""}`} />
    </div>
  );
}

function WordMeter({ words, range }: { words: number; range: [number, number] | null }) {
  if (!range) return <span className="tnum text-meta text-text-dim">{words} words</span>;
  const [low, high] = range;
  // An empty page is not out of range yet; it is the start.
  const inRange = words === 0 || (words >= low && words <= high);
  const ceiling = Math.max(high * 1.2, words);
  const pct = (n: number) => `${Math.min(100, (n / ceiling) * 100)}%`;
  return (
    <span className="flex items-center gap-3 text-meta">
      <span aria-hidden className="relative hidden h-1.5 w-32 rounded-full bg-border sm:block">
        <span className="absolute inset-y-0 rounded-full bg-border-strong"
              style={{ left: pct(low), width: `calc(${pct(high)} - ${pct(low)})` }} />
        <span className={cn("absolute -top-[3px] size-3 -translate-x-1/2 rounded-full border-2 border-bg",
                            inRange ? "bg-text" : "bg-warn")}
              style={{ left: pct(words) }} />
      </span>
      <span className={cn("tnum", inRange ? "text-text-dim" : "text-warn")}>
        {words} words, {low} to {high}
      </span>
    </span>
  );
}
