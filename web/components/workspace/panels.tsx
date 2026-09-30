"use client";
/**
 * The left pane, shared by the code, prompt and design workspaces.
 *
 * Three tabs, one question each. Brief: what is the situation and what is
 * asked. Guide: how to think about it, and help that costs something. Attempts:
 * what happened on earlier tries. The coach bar and the results pane sit on the
 * right, next to the work.
 */
import Link from "next/link";
import type { Route } from "next";
import { useState, type ReactNode } from "react";
import {
  ArrowUpRight, BookOpen, Check, Clock3, Compass, Flag, History, Lock,
} from "lucide-react";
import type { WorkspaceKit, PastSubmission } from "@/lib/problems/workspace";
import type { Difficulty } from "@/lib/policy/tiers";
import { DifficultyMeter } from "@/components/ui/difficulty";
import { Markdown } from "@/components/ui/markdown";
import { StatusIcon } from "@/components/ui/status";
import { TrackLabel } from "@/components/ui/tracks";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { ScenarioCard } from "./scenario-card";
import { DiagramFigure } from "./diagram";
import { ApproachMap } from "./approach-map";
import { CoachLog, type CoachLine } from "./coach";
import { HintLadder, type HintGate } from "./hint-ladder";
import { renderCode } from "@/components/ui/code";

export type PaneTab = "brief" | "guide" | "attempts";

export function PaneTabs({ tab, onTab, hintBadge, attemptCount }: {
  tab: PaneTab; onTab: (tab: PaneTab) => void; hintBadge: string | null; attemptCount: number;
}) {
  const tabs: Array<{ key: PaneTab; label: string; icon: typeof BookOpen; badge?: string | null }> = [
    { key: "brief", label: "Brief", icon: BookOpen },
    { key: "guide", label: "Guide", icon: Compass, badge: hintBadge },
    { key: "attempts", label: "Attempts", icon: History, badge: attemptCount ? String(attemptCount) : null },
  ];
  return (
    <div role="tablist" aria-label="Problem pane"
         className="flex h-10 shrink-0 items-end gap-1 border-b border-border px-2">
      {tabs.map(({ key, label, icon: Icon, badge }) => (
        <button key={key} type="button" role="tab" aria-selected={tab === key}
                onClick={() => onTab(key)}
                className={cn(
                  "relative -mb-px inline-flex h-9 items-center gap-1.5 border-b-2 px-2.5 font-medium",
                  tab === key ? "border-accent text-text" : "border-transparent text-text-dim hover:text-text")}>
          <Icon aria-hidden className="size-4" strokeWidth={1.75} />
          {label}
          {badge ? (
            <span className="rounded-full bg-surface-3 px-1.5 py-px font-mono text-[11px] text-text-dim">
              {badge}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

export function Section({ title, aside, children, className }: {
  title: string; aside?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={cn("space-y-3", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lead font-semibold text-text">{title}</h2>
        {aside ? <div className="text-meta text-text-faint">{aside}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** How an interview round asks the question, in the words a learner would recognise. */
const ROUND_WORDS: Readonly<Record<string, string>> = {
  written: "In a written or coding round",
  oral: "Out loud, in a conversation round",
  both: "In a coding round, and again out loud",
};

export function ProblemIntro({ title, day, skill, interview, track, difficulty, estMinutes,
                               artefactLabel, kit, briefMd, children }: {
  title: string;
  /** The day of a learner's first 30 as an FDE. */
  day?: number | null;
  /** What the problem practises. */
  skill?: string | null;
  interview?: { round: string; askedAs: string } | null;
  track: string;
  difficulty: Difficulty;
  estMinutes: number;
  artefactLabel: string;
  kit: WorkspaceKit;
  briefMd: string;
  children?: ReactNode;
}) {
  return (
    <div className="space-y-7 px-5 pb-10 pt-5">
      <div>
        {kit.build ? <BuildStepper build={kit.build} /> : null}
        {day ? (
          <p className="mb-1 text-meta font-medium text-text-faint">Day {day} as an FDE</p>
        ) : null}
        <p className="text-title font-semibold leading-tight tracking-[-0.01em] text-text">{title}</p>
        {skill ? (
          <p className="mt-1.5 text-text-dim">
            <span className="text-text-faint">You practise: </span>{renderCode(skill)}
          </p>
        ) : null}
        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-meta">
          <DifficultyMeter difficulty={difficulty} />
          <TrackLabel track={track} />
          <span className="inline-flex items-center gap-1.5 text-text-dim">
            <Clock3 aria-hidden className="size-3.5" strokeWidth={1.9} /> About {estMinutes} min
          </span>
          <span className="text-text-dim">{artefactLabel}</span>
        </div>
      </div>

      {kit.scenario ? <ScenarioCard scenario={kit.scenario} /> : null}
      {kit.diagram ? <DiagramFigure diagram={kit.diagram} /> : null}

      <Section title="The brief">
        <Markdown source={briefMd} />
      </Section>

      {interview ? (
        <Section title="In an interview">
          <figure className="rounded-panel border border-border bg-surface px-4 py-3">
            <figcaption className="text-meta text-text-faint">
              {ROUND_WORDS[interview.round] ?? "In an interview"}, it is asked as:
            </figcaption>
            <blockquote className="mt-1.5 text-text">{renderCode(interview.askedAs)}</blockquote>
          </figure>
        </Section>
      ) : null}

      {children}
    </div>
  );
}

function BuildStepper({ build }: { build: NonNullable<WorkspaceKit["build"]> }) {
  const stages = Array.from({ length: build.of }, (_, i) =>
    build.stages.find((s) => s.stage === i + 1) ?? null);
  return (
    <div className="mb-4 rounded-panel border border-border bg-surface px-3.5 py-3">
      <p className="text-meta text-text-faint">
        Capstone build, stage {build.stage} of {build.of}
      </p>
      <p className="mt-0.5 font-semibold text-text">{renderCode(build.title)}</p>
      <ol className="mt-3 flex items-center gap-1.5">
        {stages.map((stage, index) => {
          const number = index + 1;
          const current = number === build.stage;
          const body = (
            <span className={cn(
              "flex h-7 min-w-7 items-center justify-center gap-1 rounded-full border px-2",
              "font-mono text-meta",
              current ? "border-accent text-text"
                : stage?.solved ? "border-pass/40 text-pass" : "border-border-strong text-text-faint")}>
              {stage?.solved && !current ? <Check aria-hidden className="size-3.5" /> : number}
            </span>
          );
          return (
            <li key={number} className="flex items-center gap-1.5">
              {index > 0 ? <span aria-hidden className="h-px w-4 bg-border-strong" /> : null}
              {stage && !current ? (
                <Link href={`/problems/${stage.slug}` as Route} title={stage.title}
                      aria-label={`Stage ${number}: ${stage.title}`}>{body}</Link>
              ) : (
                <span aria-current={current ? "step" : undefined}
                      aria-label={`Stage ${number}${stage ? `: ${stage.title}` : ""}`}>{body}</span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function GuidePanel({ kit, hintGate, hints, onReveal, busy, noteSlot, coachLog, giveUp, onGiveUp }: {
  kit: WorkspaceKit;
  hintGate: HintGate | null;
  hints: Array<{ ordinal: number; bodyMd: string }>;
  onReveal: () => void;
  busy: boolean;
  noteSlot?: ReactNode;
  coachLog: CoachLine[] | null;
  giveUp: { allowed: boolean; label: string; reason: string | null };
  onGiveUp: () => void;
}) {
  return (
    <div className="space-y-8 px-5 pb-10 pt-5">
      {kit.approach ? (
        <Section title="How to approach it">
          <ApproachMap approach={kit.approach} />
        </Section>
      ) : null}

      {hintGate ? (
        <Section title="Hints"
                 aside={hintGate.total ? `${hintGate.revealed} of ${hintGate.total} revealed` : null}>
          {noteSlot}
          <HintLadder gate={hintGate} hints={hints} onReveal={onReveal} busy={busy} />
        </Section>
      ) : (
        <Section title="Hints">
          <p className="flex items-center gap-2 text-text-dim">
            <Lock aria-hidden className="size-4" /> This sitting runs under screen conditions, so
            hints stay closed until it ends.
          </p>
        </Section>
      )}

      {coachLog ? (
        <Section title="What the coach has said">
          <CoachLog log={coachLog} />
        </Section>
      ) : null}

      <Section title="Stuck for good">
        <p className="text-text-dim">
          Giving up opens the walkthrough and records the choice on your attempt. Faculty see it
          next to your notes.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="danger" size="sm" disabled={!giveUp.allowed} onClick={onGiveUp}>
            <Flag aria-hidden /> {giveUp.label}
          </Button>
          {!giveUp.allowed && giveUp.reason ? (
            <span className="text-meta text-text-faint">{giveUp.reason}</span>
          ) : null}
        </div>
      </Section>
    </div>
  );
}

const KIND_LABEL: Record<string, string> = {
  run: "Run", submit: "Submit", live: "Live run", rehearsal_submit: "Rehearsal submit",
};

export function AttemptsPanel({ submissions }: { submissions: PastSubmission[] }) {
  if (!submissions.length) {
    return (
      <div className="px-5 py-6">
        <p className="text-text-dim">
          Nothing run yet. Press Run to send your code through the public tests; every run and
          submit lands here with its result and a replay.
        </p>
      </div>
    );
  }
  return (
    <ol className="divide-y divide-border">
      {submissions.map((s) => {
        const kind = s.verdict === "pass" ? "pass"
          : s.verdict === null ? "running"
          : s.verdict === "error" || s.verdict === "timeout" ? "error" : "fail";
        return (
          <li key={s.id} className="flex items-center gap-3 px-5 py-3">
            <StatusIcon kind={kind} />
            <div className="min-w-0 grow">
              <p className="text-text">
                {KIND_LABEL[s.kind] ?? s.kind}
                <span className="ml-2 text-text-dim">
                  {[
                    s.publicTotal ? `${s.publicPassed}/${s.publicTotal} public` : null,
                    s.hiddenTotal ? `${s.hiddenPassed}/${s.hiddenTotal} hidden` : null,
                    s.score !== null ? `score ${Math.round(s.score)}` : null,
                  ].filter(Boolean).join(", ")}
                </span>
              </p>
              <p className="text-meta text-text-faint">
                <time dateTime={s.queuedAt}>{new Date(s.queuedAt).toLocaleString([], {
                  month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                })}</time>
                {s.llmCalls !== null ? `, ${s.llmCalls} model calls` : ""}
              </p>
            </div>
            {s.verdict !== null ? (
              <Link href={`/traces/${s.id}` as Route}
                    className="inline-flex shrink-0 items-center gap-1 text-meta text-text-dim
                               hover:text-text">
                Replay <ArrowUpRight aria-hidden className="size-3.5" />
              </Link>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/** The attempt note that gates hints on the top tier. */
/**
 * The attempt note. The text is this box's own state, so typing re-renders
 * the box and not the workspace; the workspace gets the note on blur, which
 * is also when it is saved.
 */
export function NoteBox({ note, required, onSave }: {
  /** The note as last saved. */
  note: string;
  required: number;
  onSave: (text: string) => void;
}) {
  const [text, setText] = useState(note);
  const needed = Math.max(0, required - text.length);
  return (
    <div className="space-y-2 rounded-panel border border-border bg-surface p-3.5">
      <p className="text-text">Say what you have tried and where it stops working.</p>
      <p className="text-meta text-text-dim">
        Hints on this tier open after the note reaches its length. Faculty read it to tell whether
        you are stuck on the idea or on the Python.
      </p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} onBlur={() => onSave(text)}
                rows={5}
                aria-label="Attempt note"
                className="w-full rounded-control border border-border-control bg-bg p-3 leading-relaxed
                           text-text outline-none focus:border-accent" />
      <p className="tnum text-meta text-text-faint">
        {text.length} characters{needed > 0 ? `, ${needed} to go` : ", enough to unlock hints"}
      </p>
    </div>
  );
}
