"use client";

/**
 * The two ops actions from the docs/05 runbook, and the degraded switch.
 *
 * Every one of them asks for a reason before it will do anything, because the
 * audit row is the only record of why a counter moved or why Submit was closed,
 * and the person reading it later is not the person who clicked.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { DegradedMode } from "@/lib/policy";

export function Requeue({ submissionId }: { submissionId: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const requeue = async () => {
    const reason = prompt(
      `Requeue submission #${submissionId}?\n\n` +
      "Say why. It goes in the audit log and it does not consume the learner's cap.");
    if (!reason?.trim()) return;

    setBusy(true);
    const response = await fetch(`/api/admin/submissions/${submissionId}/requeue`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { message?: string };
      alert(body.message ?? "That did not go through.");
    }
    setBusy(false);
    router.refresh();
  };

  return (
    <button type="button" onClick={requeue} disabled={busy}
            className="rounded border border-border px-2 py-1 hover:border-accent
                       disabled:opacity-40">
      {busy ? "Requeueing" : "Requeue"}
    </button>
  );
}

export function Switches({ degraded }: { degraded: DegradedMode }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    const turningOn = !degraded.on;
    let reason: string | null = null;
    if (turningOn) {
      reason = prompt(
        "Close Submit for every learner?\n\n" +
        "Say why. Learners see this where the Submit button was. Run keeps working.");
      if (!reason?.trim()) return;
    } else if (!confirm("Open Submit again for every learner?")) {
      return;
    }

    setBusy(true);
    const response = await fetch("/api/admin/degraded", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ on: turningOn, reason }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { message?: string };
      alert(body.message ?? "That did not go through.");
    }
    setBusy(false);
    router.refresh();
  };

  const clearCounter = async () => {
    const enrolmentId = prompt("Clear a rate limit counter for which enrolment id?");
    if (!enrolmentId?.trim()) return;
    const scope = prompt(
      "Which scope? run_hourly, submit_daily, live_daily, rehearsal_weekly or defence_daily.");
    if (!scope?.trim()) return;
    const reason = prompt(
      "Say why. This gives an attempt back, and the audit trail is the point.");
    if (!reason?.trim()) return;

    setBusy(true);
    const response = await fetch("/api/admin/counters", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enrolmentId: Number(enrolmentId), scope, reason }),
    });
    const body = (await response.json().catch(() => ({}))) as
      { message?: string; cleared?: number };
    alert(response.ok ? `Cleared ${body.cleared} counter row(s).`
                      : body.message ?? "That did not go through.");
    setBusy(false);
    router.refresh();
  };

  return (
    <section className="rounded border border-border p-3">
      <h2 className="mb-2 text-text-dim">SWITCHES</h2>

      <div className="mb-3">
        <button type="button" onClick={toggle} disabled={busy}
                className={`rounded px-3 py-1 ${degraded.on
                  ? "bg-accent text-bg" : "border border-warn text-warn"} disabled:opacity-40`}>
          {degraded.on ? "Open Submit again" : "Close Submit (degraded mode)"}
        </button>
        <p className="mt-1 text-text-dim">
          {degraded.on
            ? `On since ${degraded.since?.slice(0, 16).replace("T", " ")}. Run still works.`
            : "Closes Submit for every learner and leaves Run working."}
        </p>
      </div>

      <div>
        <button type="button" onClick={clearCounter} disabled={busy}
                className="rounded border border-border px-3 py-1 hover:border-accent
                           disabled:opacity-40">
          Clear a rate limit counter
        </button>
        <p className="mt-1 text-text-dim">
          For a learner who lost an attempt to a platform fault. An error verdict already
          refunds itself, so reaching for this means something else went wrong.
        </p>
      </div>
    </section>
  );
}

// Named exports rather than one object. A "use client" module's exports are
// what the server serialises across the boundary, and a namespace object
// arrives as undefined at the point React asks for an element type.
