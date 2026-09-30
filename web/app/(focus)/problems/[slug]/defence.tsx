"use client";

/**
 * The defence step. docs/03 section 4.4.
 *
 * One question, a 120-word cap, asked after a pass on a Hard or Extreme code
 * problem. The attempt is not complete until it is submitted, which is what
 * the copy here says rather than implying it is optional.
 */
import { useMemo, useState } from "react";
import { Lock, Send } from "lucide-react";
import { wordCount } from "@/lib/gate";
import type { Decision } from "@/lib/policy";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status";
import { cn } from "@/components/ui/cn";
import { useSubmission } from "./use-submission";

const WORD_CAP = 120;

interface Props {
  problemId: number;
  defence: Decision["defence"];
  question: string;
  onSettled?: () => void | Promise<void>;
}

export default function Defence(props: Props) {
  const [body, setBody] = useState("");
  const { view, running, notice, send } = useSubmission(props.problemId, props.onSettled);
  const words = useMemo(() => wordCount(body), [body]);
  const over = words > WORD_CAP;

  if (!props.defence.required) return null;

  if (!props.defence.open) {
    return (
      <section className="space-y-2">
        <h2 className="text-lead font-semibold text-text">Defence</h2>
        <p className="flex items-start gap-2 text-text-dim">
          <Lock aria-hidden className="mt-0.5 size-4 shrink-0" />
          {props.defence.reason}
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-3 rounded-panel border border-accent/50 bg-surface p-4">
      <div>
        <h2 className="text-lead font-semibold text-text">Defend the design</h2>
        <p className="mt-1 text-meta text-text-faint">
          The attempt is not complete until this is submitted. {WORD_CAP} words or fewer.
        </p>
      </div>
      <p className="leading-relaxed text-text">{props.question}</p>

      <textarea value={body} onChange={(event) => setBody(event.target.value)}
                aria-label="Your defence" rows={5}
                className="w-full resize-y rounded-control border border-border-control bg-bg p-3
                           leading-relaxed text-text outline-none focus:border-accent" />

      <div className="flex flex-wrap items-center gap-3">
        <span className={cn("tnum text-meta", over ? "text-warn" : "text-text-dim")}>
          {words} of {WORD_CAP} words
        </span>
        <Button variant="primary" size="sm" className="ml-auto"
                disabled={running || over || words === 0} onClick={() => send("defence", body)}>
          <Send aria-hidden /> {running ? "Judging" : "Submit defence"}
        </Button>
      </div>

      {over ? (
        <p className="text-meta text-warn">
          Cut {words - WORD_CAP} words. A defence over the cap is refused before it is judged.
        </p>
      ) : null}
      {notice ? <StatusBadge kind="error">{notice}</StatusBadge> : null}

      {view?.status === "terminal" ? (
        view.verdict === "error" ? (
          <StatusBadge kind="error">{view.message ?? "The judge did not complete. Try again."}</StatusBadge>
        ) : (
          <div className="space-y-2 border-t border-border pt-3">
            <p className="tnum font-medium text-text">Defence scored {view.score}.</p>
            {view.rubric.criteria.map((criterion) => (
              <blockquote key={criterion.label} className="border-l-2 border-border-control pl-3 text-text-dim">
                {criterion.evidenceQuote}
              </blockquote>
            ))}
          </div>
        )
      ) : null}
    </section>
  );
}
