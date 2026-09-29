"use client";

/**
 * The defence step. docs/03 section 4.4.
 *
 * One question, a 120-word cap, asked after a pass on a Hard or Extreme code
 * problem. The attempt is not complete until it is submitted, which is what
 * the copy here says rather than implying it is optional.
 */
import { useMemo, useState } from "react";
import { wordCount } from "@/lib/gate";
import type { Decision } from "@/lib/policy";
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
      <section className="border-t border-border p-3">
        <h2 className="mb-1 text-text-dim">Defence</h2>
        <p className="text-text-dim">{props.defence.reason}</p>
      </section>
    );
  }

  return (
    <section className="border-t border-border p-3">
      <h2 className="mb-1">Defence</h2>
      <p className="mb-2 text-text-dim">
        {props.question} Answer in {WORD_CAP} words or fewer. The attempt is not complete
        until this is submitted.
      </p>

      <textarea value={body} onChange={(event) => setBody(event.target.value)}
                aria-label="Your defence" rows={5}
                className="w-full resize-y rounded border border-border bg-bg p-2 leading-6 outline-none focus:border-accent" />

      <div className="mt-2 flex items-center gap-3">
        <span className={`tnum ${over ? "text-warn" : "text-text-dim"}`}>
          {words} of {WORD_CAP} words
        </span>
        <button type="button" disabled={running || over || words === 0}
                onClick={() => send("defence", body)}
                className="ml-auto rounded bg-accent px-3 py-1 text-bg disabled:opacity-40">
          {running ? "Judging" : "Submit defence"}
        </button>
      </div>

      {over ? (
        <p className="mt-2 text-warn">
          Cut {words - WORD_CAP} words. A defence over the cap is refused before it is judged.
        </p>
      ) : null}
      {notice ? <p className="mt-2 text-warn">{notice}</p> : null}

      {view?.status === "terminal" ? (
        view.verdict === "error" ? (
          <p className="mt-2 text-warn">{view.message ?? "The judge did not complete."}</p>
        ) : (
          <div className="mt-2">
            <p className="tnum">Defence scored {view.score}.</p>
            {view.rubric.criteria.map((criterion) => (
              <p key={criterion.label} className="text-text-dim">{criterion.evidenceQuote}</p>
            ))}
          </div>
        )
      ) : null}
    </section>
  );
}
