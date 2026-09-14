"use client";

/**
 * Submit, then watch the result arrive.
 *
 * Server-sent events with polling as the fallback, shared by all three
 * workspaces so the delivery path has one implementation rather than three
 * that drift.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { SubmissionView } from "@/lib/submissions/view";

export type SubmitKind = "run" | "submit" | "live" | "defence";

export interface SubmissionState {
  view: SubmissionView | null;
  running: boolean;
  notice: string | null;
  send: (kind: SubmitKind, body: string) => Promise<void>;
  reset: () => void;
}

export function useSubmission(
  problemId: number, onSettled?: () => void | Promise<void>,
): SubmissionState {
  const [view, setView] = useState<SubmissionView | null>(null);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const streamRef = useRef<EventSource | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const settle = useCallback(() => {
    streamRef.current?.close();
    if (timerRef.current) clearInterval(timerRef.current);
    setRunning(false);
    void onSettled?.();
  }, [onSettled]);

  const poll = useCallback((id: number) => {
    timerRef.current = setInterval(async () => {
      const response = await fetch(`/api/submissions/${id}`);
      if (!response.ok) return;
      const next = (await response.json()) as SubmissionView;
      setView(next);
      if (next.status === "terminal") settle();
    }, 1000);
    setTimeout(() => { if (timerRef.current) clearInterval(timerRef.current); }, 120_000);
  }, [settle]);

  const listen = useCallback((id: number) => {
    let settled = false;
    try {
      const stream = new EventSource(`/api/submissions/${id}/events`);
      streamRef.current = stream;
      stream.addEventListener("state", (event) => {
        setView(JSON.parse((event as MessageEvent).data) as SubmissionView);
      });
      stream.addEventListener("done", () => { settled = true; settle(); });
      stream.addEventListener("error", () => {
        if (!settled) { stream.close(); poll(id); }
      });
    } catch {
      poll(id);
    }
  }, [poll, settle]);

  const send = useCallback(async (kind: SubmitKind, body: string) => {
    setRunning(true);
    setNotice(null);
    setView(null);
    streamRef.current?.close();

    const response = await fetch("/api/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ problemId, kind, body }),
    });

    if (!response.ok) {
      const problem = (await response.json().catch(() => ({}))) as { message?: string };
      setNotice(problem.message ?? "That did not go through. Try again.");
      setRunning(false);
      void onSettled?.();
      return;
    }

    const { id } = (await response.json()) as { id: number };
    listen(id);
  }, [problemId, listen, onSettled]);

  const reset = useCallback(() => { setView(null); setNotice(null); }, []);

  useEffect(() => () => {
    streamRef.current?.close();
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  return { view, running, notice, send, reset };
}
