"use client";

/**
 * The stepper half of S7.
 *
 * Client-side because walking steps is the whole interaction and a round trip
 * per step would make it unusable. The trace arrives whole from the server,
 * already gated, so nothing here decides what the learner may see.
 */
import { useState } from "react";
import type { Replay as ReplayData, ReplayStep } from "@/lib/trace/replay";

export default function Replay({ replay }: { replay: ReplayData }) {
  const [index, setIndex] = useState(0);
  const step = replay.steps[index];
  const last = replay.steps.length - 1;

  const go = (next: number) => setIndex(Math.min(last, Math.max(0, next)));

  return (
    <>
      <section className="flex items-center gap-2 border-b border-border px-4 py-2">
        <Button label="<<" title="First step" onClick={() => go(0)} disabled={index === 0} />
        <Button label="<" title="Previous step" onClick={() => go(index - 1)}
                disabled={index === 0} />
        <span className="tnum px-2">step {index + 1} of {replay.steps.length}</span>
        <Button label=">" title="Next step" onClick={() => go(index + 1)}
                disabled={index === last} />
        <Button label=">>" title="Last step" onClick={() => go(last)} disabled={index === last} />
      </section>

      <section className="max-h-80 overflow-y-auto border-b border-border">
        <ol>
          {replay.steps.map((entry, position) => (
            <li key={entry.index}>
              {/* A submission runs several cases and their steps run on from
                  each other. Without this the list looks like one loop that
                  restarted, which is a different bug from the one it has. */}
              {position === 0 || replay.steps[position - 1]!.caseName !== entry.caseName ? (
                <p className="border-t border-border bg-surface px-4 py-1 text-text-dim">
                  case {entry.caseName}
                </p>
              ) : null}
              <button type="button" onClick={() => setIndex(position)}
                      aria-current={position === index ? "true" : undefined}
                      className={`flex w-full gap-3 px-4 py-1 text-left font-mono
                                  ${position === index ? "bg-surface-2" : "hover:bg-surface"}`}>
                <span className="tnum w-8 shrink-0 text-text-faint">
                  {String(position + 1).padStart(2, "0")}
                </span>
                <span className="w-24 shrink-0 text-text-dim">{entry.type.replace("_", " ")}</span>
                <span className="grow truncate">{entry.summary}</span>
                {entry.flags.length ? (
                  <span className="shrink-0 text-warn">{entry.flags.join(" ")}</span>
                ) : null}
                {position === index ? (
                  <span aria-hidden className="shrink-0 text-accent">&lt;- you are here</span>
                ) : null}
              </button>
            </li>
          ))}
        </ol>
      </section>

      {step ? <Selected step={step} attemptClosed={replay.attemptClosed} /> : null}
    </>
  );
}

function Selected({ step, attemptClosed }: { step: ReplayStep; attemptClosed: boolean }) {
  return (
    <section className="results-pane px-4 py-3">
      <h2 className="mb-2 text-text-dim">
        Selected step: {step.type.replace("_", " ")} in {step.caseName}
      </h2>

      {Object.entries(step.detail).map(([key, value]) => (
        <details key={key} className="border-t border-border py-1">
          <summary className="cursor-pointer text-text-dim">{key}</summary>
          <pre className="overflow-x-auto whitespace-pre-wrap py-1 font-mono">
            {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
          </pre>
        </details>
      ))}

      {step.annotation ? (
        <p className="mt-2 border-t border-border pt-2">
          <span className="text-text-dim">Annotation: </span>{step.annotation}
        </p>
      ) : null}

      {step.fixtureAnnotation ? (
        <p className="mt-2 border-t border-border pt-2">
          <span className="text-text-dim">From the problem author: </span>
          {step.fixtureAnnotation}
        </p>
      ) : !attemptClosed ? (
        <p className="mt-2 border-t border-border pt-2 text-text-faint">
          The author&apos;s notes on the adversarial cases open once this attempt closes, on a
          pass or a give-up.
        </p>
      ) : null}
    </section>
  );
}

function Button({ label, title, onClick, disabled }: {
  label: string; title: string; onClick: () => void; disabled: boolean;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title}
            className="rounded border border-border px-2 py-0.5 font-mono
                       hover:border-accent disabled:text-text-faint disabled:hover:border-border">
      {label}
    </button>
  );
}
