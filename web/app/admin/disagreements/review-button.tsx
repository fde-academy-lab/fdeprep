"use client";

/**
 * Recording what a reviewer concluded.
 *
 * Every disposition asks for a note before it will do anything, the same way
 * the ops actions do, because the note is the whole record. A row marked
 * `disputed` with nothing written on it tells the person who works the override
 * backlog that somebody disagreed, and not what they thought was wrong.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Disposition } from "@/lib/eval/review";

const PROMPTS: Readonly<Record<Disposition, string>> = {
  upheld: "The band the learner was given is right. Say what makes it right.",
  disputed: "The band the learner was given is wrong. Say which band it should be " +
            "and why. This goes on the override backlog.",
  problem_flagged: "The problem is the issue rather than the answer. Say what " +
                   "about it stops the panel separating these answers.",
};

const LABELS: Readonly<Record<Disposition, string>> = {
  upheld: "Band is right",
  disputed: "Band is wrong",
  problem_flagged: "Problem is miscalibrated",
};

export function ReviewActions({ evaluationId }: { evaluationId: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const review = async (disposition: Disposition) => {
    const note = prompt(PROMPTS[disposition]);
    if (!note?.trim()) return;

    setBusy(true);
    const response = await fetch(`/api/admin/evaluations/${evaluationId}/review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ disposition, note }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { message?: string };
      alert(body.message ?? "That did not go through.");
    }
    setBusy(false);
    router.refresh();
  };

  return (
    <div className="flex flex-wrap gap-2">
      {(Object.keys(LABELS) as Disposition[]).map((disposition) => (
        <button key={disposition} type="button" disabled={busy}
                onClick={() => review(disposition)}
                className="rounded border border-border px-2 py-1 hover:border-accent
                           disabled:opacity-40">
          {LABELS[disposition]}
        </button>
      ))}
    </div>
  );
}
