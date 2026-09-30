"use client";
/**
 * The live coach: one sentence at a time, at the right moment.
 *
 * It asks the server after the learner pauses typing, straight after a run
 * finishes, and as idle time passes. It never interrupts mid-keystroke, never
 * says a new thing more often than every twenty seconds unless a run just
 * finished, and stays quiet once told "got it" until the code changes enough
 * for a different signal to fire. That rhythm is the whole difference between
 * a coach and a linter.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { CircleCheck, Lightbulb, X } from "lucide-react";
import { LogoMark } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";

export interface CoachLine { id: string; say: string; at: number }

const PAUSE_MS = 2500;
/** On arrival the opening line gets time to be read before anything replaces it. */
const FIRST_LOOK_MS = 12_000;
const THROTTLE_MS = 20_000;
const IDLE_TICK_MS = 30_000;

export function useCoach(options: {
  problemId: number;
  enabled: boolean;
  text: string;
  /** Changes whenever a run or submit finishes, which asks the coach at once. */
  settledKey: number;
}) {
  const { problemId, enabled, text, settledKey } = options;
  const storageKey = `fdeprep.coach.dismissed.${problemId}`;
  const [current, setCurrent] = useState<CoachLine | null>(null);
  const [log, setLog] = useState<CoachLine[]>([]);
  const [wrapUp, setWrapUp] = useState<string | null>(null);
  const dismissed = useRef<Set<string>>(new Set());
  const lastEdit = useRef(Date.now());
  const lastShown = useRef(0);
  const held = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<AbortController | null>(null);
  const textRef = useRef(text);
  const firstText = useRef(text);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) dismissed.current = new Set(JSON.parse(saved) as string[]);
    } catch { /* storage blocked: the coach simply forgets dismissals on reload */ }
  }, [storageKey]);

  const show = useCallback((line: { id: string; say: string } | null, urgent: boolean) => {
    if (held.current) { clearTimeout(held.current); held.current = null; }
    if (!line) { setCurrent(null); return; }
    const apply = () => {
      lastShown.current = Date.now();
      const entry = { ...line, at: Date.now() };
      setCurrent((prior) => (prior?.id === line.id ? prior : entry));
      setLog((prior) => (prior[prior.length - 1]?.id === line.id ? prior : [...prior, entry]));
    };
    const wait = THROTTLE_MS - (Date.now() - lastShown.current);
    if (urgent || wait <= 0) apply();
    else held.current = setTimeout(apply, wait);
  }, []);

  const ask = useCallback(async (urgent: boolean) => {
    if (!enabled) return;
    inflight.current?.abort();
    const controller = new AbortController();
    inflight.current = controller;
    try {
      const response = await fetch(`/api/problems/${problemId}/coach`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          code: textRef.current,
          idleMinutes: Math.floor((Date.now() - lastEdit.current) / 60_000),
          dismissed: [...dismissed.current],
        }),
      });
      if (!response.ok) return;
      const reply = (await response.json()) as {
        nudge: { id: string; say: string } | null; wrapUp: string | null;
      };
      setWrapUp(reply.wrapUp);
      show(reply.nudge, urgent);
    } catch {
      // A dropped request is a coach that stays quiet, never an error on screen.
    }
  }, [enabled, problemId, show]);

  // After the learner pauses typing. Untouched starter code waits longer, so
  // the opening line is read before a nudge replaces it.
  useEffect(() => {
    textRef.current = text;
    lastEdit.current = Date.now();
    const untouched = text === firstText.current;
    const timer = setTimeout(() => void ask(false), untouched ? FIRST_LOOK_MS : PAUSE_MS);
    return () => clearTimeout(timer);
  }, [text, ask]);

  // Straight after a run or submit settles.
  useEffect(() => {
    if (settledKey > 0) void ask(true);
  }, [settledKey, ask]);

  // As idle time passes, while the tab is in front of the learner.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && Date.now() - lastEdit.current > 55_000) {
        void ask(false);
      }
    }, IDLE_TICK_MS);
    return () => clearInterval(timer);
  }, [ask]);

  useEffect(() => () => {
    inflight.current?.abort();
    if (held.current) clearTimeout(held.current);
  }, []);

  const dismiss = useCallback((id: string) => {
    dismissed.current.add(id);
    try { localStorage.setItem(storageKey, JSON.stringify([...dismissed.current])); } catch { /* blocked */ }
    setCurrent(null);
    void ask(false);
  }, [ask, storageKey]);

  return { current, log, wrapUp, dismiss };
}

export function CoachBar({ current, wrapUp, opening, enabled, onDismiss, onHint, hintLabel, idleText }: {
  current: CoachLine | null;
  wrapUp: string | null;
  opening: string | null;
  enabled: boolean;
  onDismiss: (id: string) => void;
  onHint?: () => void;
  hintLabel?: string;
  /** What the bar says when there is nothing to flag. */
  idleText: string;
}) {
  if (!enabled) return null;

  const passed = wrapUp !== null && current === null;
  const text = passed ? wrapUp : current?.say ?? opening ?? idleText;
  const quiet = !passed && !current;

  return (
    <div className={cn("flex items-start gap-3 border-y px-3 py-2.5",
                       passed ? "border-pass/30 bg-pass-soft" : "border-border bg-surface")}>
      <span className="mt-px shrink-0">
        {passed ? <CircleCheck aria-hidden className="size-5 text-pass" /> : <LogoMark className="size-5" />}
      </span>
      <div className="min-w-0 grow" aria-live="polite" aria-atomic="true">
        <p className="text-meta font-medium text-text-faint">
          {passed ? "What this problem was for" : "Coach"}
        </p>
        <p key={current?.id ?? (passed ? "wrap" : "quiet")}
           className={cn("mt-0.5 leading-snug", quiet ? "text-text-dim" : "text-text",
                         current && "rise-in")}>
          {text}
        </p>
      </div>
      {current ? (
        <div className="flex shrink-0 items-center gap-1.5">
          {onHint ? (
            <Button size="sm" variant="ghost" onClick={onHint}>
              <Lightbulb aria-hidden /> {hintLabel ?? "Hints"}
            </Button>
          ) : null}
          <Button size="sm" variant="secondary" onClick={() => onDismiss(current.id)}
                  aria-label="Got it, dismiss this nudge">
            <X aria-hidden /> Got it
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** Everything the coach has said on this visit, for a learner who looked away. */
export function CoachLog({ log }: { log: CoachLine[] }) {
  if (!log.length) {
    return <p className="text-text-dim">The coach has not flagged anything yet. It speaks when your code shows a mistake this problem is about, or when a run fails.</p>;
  }
  return (
    <ol className="space-y-2">
      {[...log].reverse().map((line) => (
        <li key={`${line.id}-${line.at}`} className="flex gap-3 rounded-control border border-border
                                                   bg-surface px-3 py-2">
          <LogoMark className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0">
            <p className="text-text">{line.say}</p>
            <p className="mt-0.5 text-meta text-text-faint">
              <time dateTime={new Date(line.at).toISOString()}>
                {new Date(line.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </time>
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
