"use client";
/**
 * The hint ladder. Every rung is drawn from the start, so a learner can see
 * how much help exists and what the next rung costs before spending it. The
 * text of a rung the learner has not revealed never reaches the browser: the
 * server sends a hint only when the policy allows it.
 */
import { Lock, LockOpen } from "lucide-react";
import { Markdown } from "@/components/ui/markdown";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";

export interface HintGate {
  allowed: boolean;
  reason: string | null;
  label: string;
  total: number;
  revealed: number;
  nextOrdinal: number | null;
}

export function HintLadder({ gate, hints, onReveal, busy }: {
  gate: HintGate;
  hints: Array<{ ordinal: number; bodyMd: string }>;
  onReveal: () => void;
  busy: boolean;
}) {
  if (gate.total === 0) {
    return <p className="text-text-dim">This problem has no hints. The approach map above is the guide.</p>;
  }
  const byOrdinal = new Map(hints.map((h) => [h.ordinal, h]));
  const rungs = Array.from({ length: gate.total }, (_, i) => i + 1);

  return (
    <ol className="relative space-y-2">
      {rungs.map((ordinal) => {
        const hint = byOrdinal.get(ordinal);
        const next = ordinal === gate.nextOrdinal;
        return (
          <li key={ordinal}
              className={cn("rounded-panel border px-3.5 py-3",
                            hint ? "border-border bg-surface"
                              : next ? "border-dashed border-border-control bg-surface"
                              : "border-dashed border-border bg-transparent")}>
            <div className="flex items-start gap-3">
              <span className={cn("grid size-6 shrink-0 place-items-center rounded-full border",
                                  "font-mono text-meta font-semibold",
                                  hint ? "border-border-control text-text"
                                    : "border-border text-text-faint")}>
                {ordinal}
              </span>
              <div className="min-w-0 grow pt-0.5">
                {hint ? (
                  <Markdown source={hint.bodyMd} compact className="rise-in" />
                ) : next ? (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <Button size="sm" variant={gate.allowed ? "secondary" : "ghost"}
                            disabled={!gate.allowed || busy} onClick={onReveal}>
                      {gate.allowed ? <LockOpen aria-hidden /> : <Lock aria-hidden />}
                      {gate.label}
                    </Button>
                    {!gate.allowed && gate.reason ? (
                      <span className="text-meta text-text-faint">{gate.reason}</span>
                    ) : null}
                  </div>
                ) : (
                  <p className="flex items-center gap-2 text-meta text-text-faint">
                    <Lock aria-hidden className="size-3.5" /> Opens after hint {ordinal - 1}
                  </p>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
