"use client";

import { useState, useTransition } from "react";
import { publishAll } from "./actions";

export default function PublishButton({ disabled }: { disabled: boolean }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  return (
    <div className="mt-6 flex items-center gap-3">
      <button
        type="button" disabled={disabled || pending}
        onClick={() => start(async () => {
          const outcome = await publishAll();
          setResult(
            `Published ${outcome.published} problem version` +
            `${outcome.published === 1 ? "" : "s"}, skipped ${outcome.skipped}.`);
        })}
        className="rounded border border-accent px-3 py-1 text-accent
                   disabled:border-border disabled:text-text-faint">
        {pending ? "Publishing" : "Publish"}
      </button>
      {result && <span className="text-pass">{result}</span>}
    </div>
  );
}
