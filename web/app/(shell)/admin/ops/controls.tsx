"use client";

/**
 * The two ops actions from the docs/05 runbook, and the degraded switch.
 *
 * Every one of them asks for a reason before it will do anything, because the
 * audit row is the only record of why a counter moved or why Submit was closed,
 * and the person reading it later is not the person who clicked. Each asks in
 * a dialog, and a refusal from the route lands inside that dialog.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Scope } from "@/lib/policy";
import { Button } from "@/components/ui/button";
import { DialogForm, post } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";

export function Requeue({ submissionId }: { submissionId: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>Requeue</Button>
      <DialogForm open={open} onClose={() => setOpen(false)} title="Requeue"
                  submitLabel="Requeue" busyLabel="Requeueing"
                  onSubmit={async (data) => {
                    await post(`/api/admin/submissions/${submissionId}/requeue`,
                               { reason: data.get("reason") });
                    router.refresh();
                    return null;
                  }}>
        <p>
          Requeue submission #{submissionId}? Say why. It goes in the audit log and it does not
          consume the learner&apos;s cap.
        </p>
        <Field label="Why">
          <Textarea name="reason" required />
        </Field>
      </DialogForm>
    </>
  );
}

export function Switches({ degraded, since, scopes }: {
  degraded: { on: boolean };
  /** When degraded mode went on, already written as "8 Oct 14:02" by the server. */
  since: string | null;
  scopes: readonly Scope[];
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"degraded" | "counter" | null>(null);
  const close = () => setDialog(null);

  return (
    <section aria-labelledby="switches" className="rounded-panel border border-border bg-surface p-4">
      <h2 id="switches" className="text-lead font-semibold text-text">Switches</h2>

      <div className="mt-4 flex items-center gap-4">
        <Button variant={degraded.on ? "primary" : "warn"} onClick={() => setDialog("degraded")}>
          {degraded.on ? "Open Submit again" : "Close Submit, degraded mode"}
        </Button>
        <p className="text-text-dim">
          {!degraded.on ? "Closes Submit for every learner and leaves Run working."
            : since ? `On since ${since}. Run still works.` : "On. Run still works."}
        </p>
      </div>

      <div className="mt-3 flex items-center gap-4">
        <Button onClick={() => setDialog("counter")}>Clear a rate limit counter</Button>
        <p className="text-text-dim">
          For a learner who lost an attempt to a platform fault. An error verdict already refunds
          itself, so reaching for this means something else went wrong.
        </p>
      </div>

      <DialogForm open={dialog === "degraded"} onClose={close}
                  title={degraded.on ? "Open Submit again" : "Close Submit, degraded mode"}
                  submitLabel={degraded.on ? "Open Submit again" : "Close Submit"}
                  submitVariant={degraded.on ? "primary" : "warn"}
                  onSubmit={async (data) => {
                    await post("/api/admin/degraded",
                               { on: !degraded.on, reason: degraded.on ? null : data.get("reason") });
                    router.refresh();
                    return null;
                  }}>
        {degraded.on ? (
          <p>Open Submit again for every learner?</p>
        ) : (
          <>
            <p>
              Close Submit for every learner? Say why. Learners see this where the Submit button
              was. Run keeps working.
            </p>
            <Field label="Why">
              <Textarea name="reason" required />
            </Field>
          </>
        )}
      </DialogForm>

      <DialogForm open={dialog === "counter"} onClose={close} title="Clear a rate limit counter"
                  submitLabel="Clear"
                  onSubmit={async (data) => {
                    const { cleared } = await post<{ cleared: number }>("/api/admin/counters", {
                      login: data.get("login"),
                      scope: data.get("scope"),
                      reason: data.get("reason"),
                    });
                    router.refresh();
                    return <p>Cleared {cleared} counter {cleared === 1 ? "row" : "rows"}.</p>;
                  }}>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Learner">
            <Input name="login" required placeholder="github login" autoComplete="off" spellCheck={false} />
          </Field>
          <Field label="Scope">
            <Select name="scope" required>
              {scopes.map((scope) => <option key={scope} value={scope}>{scope}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Why" help="This gives an attempt back, and the audit trail is the point.">
          <Textarea name="reason" required />
        </Field>
      </DialogForm>
    </section>
  );
}

// Named exports rather than one object. A "use client" module's exports are
// what the server serialises across the boundary, and a namespace object
// arrives as undefined at the point React asks for an element type.
