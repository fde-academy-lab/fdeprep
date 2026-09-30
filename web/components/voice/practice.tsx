"use client";
/**
 * Timed practice for a deployment where graded voice sessions are not
 * switched on. It runs the question's clock and walks the beats by their time
 * budgets, which is the part of the cockpit that needs no server. Nothing is
 * recorded, transcribed or sent anywhere, so it needs no consent and leaves no
 * trace.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";

interface Beat { key: string; label: string; seconds: number }

function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function VoicePractice({ prompt, beats, totalSeconds }: {
  prompt: string; beats: Beat[]; totalSeconds: number;
}) {
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);
  const started = useRef<number | null>(null);
  const base = useRef(0);

  useEffect(() => {
    if (!running) return;
    started.current = performance.now();
    const timer = setInterval(() => {
      const next = base.current + (performance.now() - (started.current ?? performance.now())) / 1000;
      setElapsed(next);
      if (next >= totalSeconds) { setRunning(false); base.current = totalSeconds; }
    }, 200);
    return () => {
      clearInterval(timer);
      base.current += (performance.now() - (started.current ?? performance.now())) / 1000;
    };
  }, [running, totalSeconds]);

  const bounds = useMemo(() => {
    let at = 0;
    return beats.map((beat) => {
      const start = at;
      at += beat.seconds;
      return { ...beat, start, end: at };
    });
  }, [beats]);
  const current = bounds.findIndex((b) => elapsed < b.end);
  const done = elapsed >= totalSeconds;

  return (
    <div className="space-y-6">
      <p className="text-lead leading-relaxed text-text">{prompt}</p>
      <div className="flex flex-wrap items-center gap-5">
        <p aria-live="off" className={cn("tnum font-mono text-clock font-semibold tracking-tight",
                                          done ? "text-text-dim" : "text-text")}>
          {clock(totalSeconds - elapsed)}
        </p>
        <div className="flex gap-2">
          {done ? (
            <Button variant="primary" onClick={() => { base.current = 0; setElapsed(0); setRunning(true); }}>
              <RotateCcw aria-hidden /> Go again
            </Button>
          ) : (
            <Button variant="primary" onClick={() => setRunning((r) => !r)}>
              {running ? <><Pause aria-hidden /> Pause</> : <><Play aria-hidden /> {elapsed ? "Resume" : "Start speaking"}</>}
            </Button>
          )}
          {elapsed > 0 && !done ? (
            <Button variant="ghost" onClick={() => { setRunning(false); base.current = 0; setElapsed(0); }}>
              Reset
            </Button>
          ) : null}
        </div>
      </div>
      <ol className="space-y-2" aria-label="Beats">
        {bounds.map((beat, index) => {
          const state = done || index < current ? "past" : index === current && elapsed > 0 ? "now" : "next";
          const share = state === "now" ? Math.min(1, (elapsed - beat.start) / beat.seconds) : state === "past" ? 1 : 0;
          return (
            <li key={beat.key} aria-current={state === "now" ? "step" : undefined}
                className={cn("relative overflow-hidden rounded-panel border px-4 py-3",
                              state === "now" ? "border-accent/60 bg-surface" : "border-border bg-surface")}>
              <span aria-hidden className="absolute inset-y-0 left-0 bg-accent-soft"
                    style={{ width: `${share * 100}%` }} />
              <span className="relative flex items-baseline justify-between gap-4">
                <span className={cn(state === "past" ? "text-text-dim" : "text-text")}>
                  <span className="mr-2 font-mono text-meta text-text-faint">{index + 1}</span>
                  {beat.label}
                </span>
                <span className="tnum shrink-0 font-mono text-meta text-text-faint">{clock(beat.seconds)}</span>
              </span>
            </li>
          );
        })}
      </ol>
      {done ? (
        <p className="text-text-dim">
          Time. Say out loud which beat ran long and which you skipped; that is the note a
          graded session would have written for you.
        </p>
      ) : null}
    </div>
  );
}
