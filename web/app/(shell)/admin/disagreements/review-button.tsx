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
import { BAND_WORD, BANDS, type Band } from "@/lib/policy/bands";
import { Button } from "@/components/ui/button";
import { DialogForm, post } from "@/components/ui/dialog";
import { Field, Select, Textarea } from "@/components/ui/field";

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

export function OverrideAction({ evaluationId, held }: {
  evaluationId: number; held: Band;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>Correct the grade</Button>
      <DialogForm open={open} onClose={() => setOpen(false)} title="Correct the grade"
                  submitLabel="Correct the grade"
                  onSubmit={async (data) => {
                    await post(`/api/admin/evaluations/${evaluationId}/override`,
                               { band: data.get("band"), note: data.get("note") });
                    router.refresh();
                    return null;
                  }}>
        <p>
          Which band is right? A design answer passes at adequate or better, so this can change the
          learner&apos;s verdict and their competency heatmap. The panel gave {BAND_WORD[held]}.
        </p>
        <Field label="Band">
          <Select name="band" required>
            {BANDS.map((band) => <option key={band} value={band}>{BAND_WORD[band]}</option>)}
          </Select>
        </Field>
        <Field label="Why the panel was wrong" help="A learner may ask, and this is the answer.">
          <Textarea name="note" required />
        </Field>
      </DialogForm>
    </>
  );
}

export function ReviewActions({ evaluationId }: { evaluationId: number }) {
  const router = useRouter();
  const [reading, setReading] = useState<Disposition | null>(null);

  return (
    <div className="flex gap-1.5">
      {(Object.keys(LABELS) as Disposition[]).map((disposition) => (
        <Button key={disposition} size="sm" onClick={() => setReading(disposition)}>
          {LABELS[disposition]}
        </Button>
      ))}
      <DialogForm open={reading !== null} onClose={() => setReading(null)}
                  title={reading ? LABELS[reading] : ""} submitLabel="Record"
                  onSubmit={async (data) => {
                    await post(`/api/admin/evaluations/${evaluationId}/review`,
                               { disposition: reading, note: data.get("note") });
                    router.refresh();
                    return null;
                  }}>
        <p>{reading ? PROMPTS[reading] : null}</p>
        <Field label="Note">
          <Textarea name="note" required />
        </Field>
      </DialogForm>
    </div>
  );
}
