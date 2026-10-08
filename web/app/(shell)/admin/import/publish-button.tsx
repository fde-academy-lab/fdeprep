"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { publishAll } from "./actions";

/** Publish, the page's one action, with what it did written beside it. */
export default function PublishButton({ disabled }: { disabled: boolean }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-3">
      {result ? <span role="status" className="text-text-dim">{result}</span> : null}
      <Button variant="primary" disabled={disabled || pending}
              onClick={() => start(async () => {
                const outcome = await publishAll();
                setResult(
                  `Published ${outcome.published} problem version` +
                  `${outcome.published === 1 ? "" : "s"}, skipped ${outcome.skipped}.`);
              })}>
        {pending ? "Publishing" : "Publish"}
      </Button>
    </div>
  );
}
