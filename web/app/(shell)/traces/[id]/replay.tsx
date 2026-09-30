"use client";

/**
 * The stepper half of S7: a timeline on the left, the selected step on the
 * right, the way a debugger lays out a call stack and its frame.
 *
 * Client-side because walking steps is the whole interaction and a round trip
 * per step would make it unusable. The trace arrives whole from the server,
 * already gated, so nothing here decides what the learner may see. J and K,
 * or the arrow keys, walk it.
 */
import { useEffect, useState } from "react";
import {
  ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, Cpu, Eye, Flag, MapPin, Wrench,
  type LucideIcon,
} from "lucide-react";
import type { Replay as ReplayData, ReplayStep, StepType } from "@/lib/trace/replay";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/components/ui/cn";

const LOOK: Record<StepType, { icon: LucideIcon; label: string }> = {
  llm_call: { icon: Cpu, label: "Model call" },
  tool_call: { icon: Wrench, label: "Tool call" },
  observation: { icon: Eye, label: "Observation" },
  final: { icon: Flag, label: "Final answer" },
  marker: { icon: MapPin, label: "Marker" },
};

export default function Replay({ replay }: { replay: ReplayData }) {
  const [index, setIndex] = useState(0);
  const step = replay.steps[index];
  const last = replay.steps.length - 1;
  const go = (next: number) => setIndex(Math.min(last, Math.max(0, next)));

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const el = event.target as HTMLElement | null;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA"].includes(el.tagName))) return;
      if (event.key === "j" || event.key === "ArrowDown") { event.preventDefault(); setIndex((i) => Math.min(last, i + 1)); }
      if (event.key === "k" || event.key === "ArrowUp") { event.preventDefault(); setIndex((i) => Math.max(0, i - 1)); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [last]);

  useEffect(() => {
    document.getElementById(`trace-step-${index}`)?.scrollIntoView({ block: "nearest" });
  }, [index]);

  return (
    <div className="grid min-h-[60vh] overflow-hidden rounded-panel border border-border lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <section className="flex min-h-0 flex-col border-b border-border bg-surface lg:border-b-0 lg:border-r">
        <div className="flex items-center gap-1 border-b border-border px-3 py-2">
          <IconButton title="First step" onClick={() => go(0)} disabled={index === 0} icon={ChevronFirst} />
          <IconButton title="Previous step" onClick={() => go(index - 1)} disabled={index === 0} icon={ChevronLeft} />
          <span className="tnum px-2 text-meta text-text-dim">Step {index + 1} of {replay.steps.length}</span>
          <IconButton title="Next step" onClick={() => go(index + 1)} disabled={index === last} icon={ChevronRight} />
          <IconButton title="Last step" onClick={() => go(last)} disabled={index === last} icon={ChevronLast} />
          <span className="ml-auto hidden items-center gap-1 text-meta text-text-faint sm:inline-flex">
            <Kbd>J</Kbd><Kbd>K</Kbd> to step
          </span>
        </div>
        <ol className="relative max-h-[70vh] min-h-0 flex-1 overflow-y-auto py-1">
          {replay.steps.map((entry, position) => {
            const look = LOOK[entry.type] ?? LOOK.marker;
            const Icon = look.icon;
            const newCase = position === 0 || replay.steps[position - 1]!.caseName !== entry.caseName;
            return (
              <li key={entry.index}>
                {/* A submission runs several cases and their steps run on from
                    each other. Without this the list looks like one loop that
                    restarted, which is a different bug from the one it has. */}
                {newCase ? (
                  <p className="px-4 pb-1 pt-3 text-meta font-medium text-text-faint">
                    Case {entry.caseName.replace(/_/g, " ")}
                  </p>
                ) : null}
                <button id={`trace-step-${position}`} type="button" onClick={() => setIndex(position)}
                        aria-current={position === index ? "step" : undefined}
                        className={cn("relative flex w-full items-center gap-3 px-4 py-1.5 text-left",
                                      position === index ? "bg-surface-3" : "hover:bg-surface-2")}>
                  {position === index ? (
                    <span aria-hidden className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-accent" />
                  ) : null}
                  <span className="tnum w-6 shrink-0 font-mono text-meta text-text-faint">
                    {String(position + 1).padStart(2, "0")}
                  </span>
                  <Icon aria-hidden className="size-4 shrink-0 text-text-dim" strokeWidth={1.75} />
                  <span className="sr-only">{look.label}</span>
                  <span className="min-w-0 grow truncate font-mono text-meta text-text">{entry.summary}</span>
                  {entry.flags.length ? (
                    <span className="shrink-0 rounded-full border border-warn/40 px-1.5 text-[11px] text-warn">
                      {entry.flags.length === 1 ? entry.flags[0]!.replace(/_/g, " ") : `${entry.flags.length} flags`}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ol>
      </section>

      {step ? <Selected step={step} attemptClosed={replay.attemptClosed} /> : null}
    </div>
  );
}

function Selected({ step, attemptClosed }: { step: ReplayStep; attemptClosed: boolean }) {
  const look = LOOK[step.type] ?? LOOK.marker;
  const Icon = look.icon;
  return (
    <section className="results-pane relative min-h-0 overflow-y-auto bg-bg p-5">
      <p className="flex items-center gap-2 font-semibold text-text">
        <Icon aria-hidden className="size-4 text-text-dim" /> {look.label}
        <span className="font-normal text-text-faint">in case {step.caseName.replace(/_/g, " ")}</span>
      </p>

      {step.flags.length ? (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {step.flags.map((flag) => (
            <li key={flag} className="rounded-full border border-warn/40 bg-warn-soft px-2.5 py-0.5 text-meta text-text">
              {flag.replace(/_/g, " ")}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-4 space-y-3">
        {Object.entries(step.detail).map(([key, value]) => (
          <div key={key}>
            <p className="mb-1 text-meta font-medium text-text-faint">{key.replace(/_/g, " ")}</p>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-control border border-border
                            bg-surface px-3 py-2.5 font-mono text-meta leading-relaxed text-text">
              {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
            </pre>
          </div>
        ))}
      </div>

      {step.annotation ? (
        <p className="mt-4 rounded-control border-l-2 border-text-faint bg-surface-2 px-3 py-2 text-text">
          {step.annotation}
        </p>
      ) : null}

      {step.fixtureAnnotation ? (
        <div className="mt-4 rounded-panel border border-border bg-surface px-4 py-3">
          <p className="text-meta font-medium text-text-faint">From the problem author</p>
          <p className="mt-1 text-text">{step.fixtureAnnotation}</p>
        </div>
      ) : !attemptClosed ? (
        <p className="mt-4 text-meta text-text-faint">
          The author&apos;s notes on the adversarial cases open once this attempt closes, on a
          pass or a give-up.
        </p>
      ) : null}
    </section>
  );
}

function IconButton({ title, onClick, disabled, icon: Icon }: {
  title: string; onClick: () => void; disabled: boolean; icon: LucideIcon;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title} aria-label={title}
            className="grid size-7 place-items-center rounded-control text-text-dim hover:bg-surface-2
                       hover:text-text disabled:text-text-faint disabled:hover:bg-transparent">
      <Icon aria-hidden className="size-4" />
    </button>
  );
}
