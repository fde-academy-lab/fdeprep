"use client";

/**
 * Plays an interviewer's lines in order: the opening line, then the question.
 *
 * Only in the lobby, before an answer starts, so nothing here runs while the
 * learner speaks. Each address is on this application and is resolved on the
 * server, which synthesises the line on its first request. When a line cannot
 * be played the words are shown instead, so the learner never loses what the
 * interviewer said.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Square, Volume2 } from "lucide-react";
import { buttonClass } from "@/components/ui/button";

type State = "idle" | "playing" | "failed";

export function HearButton({ urls, label, fallback }: {
  urls: string[];
  label: string;
  /** The words, shown when the audio cannot be played. */
  fallback: string;
}) {
  const [state, setState] = useState<State>("idle");
  const audio = useRef<HTMLAudioElement | null>(null);
  const stopped = useRef(false);

  const stop = useCallback(() => {
    stopped.current = true;
    audio.current?.pause();
    audio.current = null;
    setState("idle");
  }, []);

  useEffect(() => () => {
    stopped.current = true;
    audio.current?.pause();
  }, []);

  const play = useCallback(async () => {
    stopped.current = false;
    setState("playing");
    for (const url of urls) {
      if (stopped.current) return;
      const element = new Audio(url);
      audio.current = element;
      const finished = new Promise<boolean>((resolve) => {
        element.onended = () => resolve(true);
        element.onerror = () => resolve(false);
      });
      try {
        await element.play();
      } catch {
        setState("failed");
        return;
      }
      if (!(await finished)) {
        setState("failed");
        return;
      }
    }
    if (!stopped.current) setState("idle");
  }, [urls]);

  return (
    <div>
      <button type="button" className={buttonClass("secondary", "sm")}
              onClick={() => (state === "playing" ? stop() : void play())}>
        {state === "playing"
          ? <><Square aria-hidden /> Stop</>
          : <><Volume2 aria-hidden /> {label}</>}
      </button>
      {state === "failed" ? (
        <p className="mt-2 text-text-dim" role="status">
          The interviewer could not be played here, so here is what they said. {fallback}
        </p>
      ) : null}
    </div>
  );
}
