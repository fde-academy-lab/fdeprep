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

const BAND_PROMPT =
  "Which band is right? strong, adequate, weak or off_question.\n\n" +
  "A design answer passes at adequate or better, so this can change the " +
  "learner's verdict and their competency heatmap.";

export function OverrideAction({ evaluationId, held }: {
  evaluationId: number; held: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const override = async () => {
    const band = prompt(`${BAND_PROMPT}\n\nThe panel gave ${held}.`);
    if (!band?.trim()) return;
    const note = prompt(
      "Say what the answer does and why the panel was wrong. A learner may ask, " +
      "and this is the answer.");
    if (!note?.trim()) return;

    setBusy(true);
    const response = await fetch(`/api/admin/evaluations/${evaluationId}/override`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ band: band.trim(), note }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { message?: string };
      alert(body.message ?? "That did not go through.");
    }
    setBusy(false);
    router.refresh();
  };

  return (
    <button type="button" onClick={override} disabled={busy}
            className="rounded border border-accent px-2 py-1 text-accent
                       hover:bg-accent hover:text-bg disabled:opacity-40">
      {busy ? "Correcting" : "Correct the grade"}
    </button>
  );
}

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
