"use client";

/**
 * Typing the answer instead of speaking it. docs/07, as amended 30 September
 * 2026.
 *
 * A separate component from the cockpit on purpose. The cockpit must never
 * render the learner's words while they answer, and a text box is nothing but
 * the learner's words, so the two cannot share a file without the rule the
 * cockpit is built around becoming a rule with an exception.
 *
 * Guided shows the beats as a list to answer against, which is what the beat
 * track gives a speaker. Unguided shows the question alone. The word limit is
 * what the question's clock would let anyone say out loud, and the server
 * enforces it again.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import type { VoiceQuestion } from "@/lib/voice/question";
import { readReply } from "@/lib/http/reply";
import { Button } from "@/components/ui/button";

export function TypedAnswer({ question, mode, wordLimit }: {
  question: VoiceQuestion;
  mode: "guided" | "unguided";
  wordLimit: number;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const over = words > wordLimit;

  async function send() {
    setSending(true);
    setNote(null);
    let response: Response;
    try {
      response = await fetch("/api/voice/sessions/typed", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode, question: question.slug, text }),
      });
    } catch {
      setNote("Your answer did not reach the server and was not saved. It is still in the box: " +
              "check the connection and send it again.");
      setSending(false);
      return;
    }
    // Read whatever came back without assuming it is JSON, so a server error
    // says it was the server and keeps its status.
    const reply = await readReply<{ sessionId?: number }>(response);
    setSending(false);
    if (!reply.ok || typeof reply.body?.sessionId !== "number") {
      setNote(reply.message ?? `Your answer was not saved: the server answered ${reply.status}. ` +
              "It is still in the box, so send it again in a minute.");
      return;
    }
    router.push(`/voice/sessions/${reply.body.sessionId}` as Route);
  }

  return (
    <div className="mt-6 space-y-5">
      <p className="whitespace-pre-line text-lead leading-relaxed text-text">{question.promptText}</p>

      {mode === "guided" ? (
        <ol className="grid gap-1.5 rounded-panel border border-border bg-surface p-4 sm:grid-cols-2">
          {question.beats.map((beat) => (
            <li key={beat.key} className="text-text-dim">
              <span className="font-mono text-text-faint">{beat.key}</span> {beat.label}
            </li>
          ))}
        </ol>
      ) : null}

      <label className="block">
        <span className="text-meta text-text-faint">
          Your answer, as you would say it in the room
        </span>
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={12}
          className="mt-1.5 block w-full resize-y rounded-control border border-border-strong bg-surface
                     px-3 py-2 leading-relaxed text-text outline-none focus:border-border-control"
        />
      </label>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className={`tnum text-meta ${over ? "text-warn" : "text-text-faint"}`}>
          {words} of {wordLimit} words
        </span>
        <Button variant="primary" onClick={() => void send()}
                disabled={sending || words === 0 || over}>
          {sending ? "Sending" : "Send for scoring"}
        </Button>
      </div>
      {over ? (
        <p className="text-warn">
          The clock on this question allows about {wordLimit} spoken words. Cut the answer to
          that and send it.
        </p>
      ) : null}
      <p className="text-meta text-text-faint">
        Scored on content and on which beats you covered. Pace is not scored, because a typed
        answer has no clock. It spends one {mode} answer from today&apos;s allowance.
      </p>
      {note ? <p className="text-warn">{note}</p> : null}
    </div>
  );
}
