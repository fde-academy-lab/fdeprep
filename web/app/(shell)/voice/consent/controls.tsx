"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status";

export function ConsentControls({
  granted,
  grantedAt,
}: {
  granted: boolean;
  grantedAt: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(method: "POST" | "DELETE") {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/voice/consent", { method });
      if (!response.ok) {
        const body = (await response.json()) as { message?: string };
        setError(body.message ?? "That did not save. Try again.");
        return;
      }
      router.refresh();
    } catch {
      setError("That did not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (granted) {
    return (
      <div className="mt-6">
        <StatusBadge kind="pass">
          You accepted on {grantedAt ? new Date(grantedAt).toLocaleDateString() : "an earlier day"}.
        </StatusBadge>
        <div className="mt-3">
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => void call("DELETE")}>
            Withdraw consent
          </Button>
        </div>
        <p className="mt-2 text-meta text-text-faint">
          Withdrawing stops new sessions. It does not delete recordings you already made; each
          session has its own delete button.
        </p>
        {error && <p className="mt-3 text-fail">{error}</p>}
      </div>
    );
  }

  return (
    <div className="mt-6">
      <Button variant="primary" size="lg" disabled={busy} onClick={() => void call("POST")}>
        {busy ? "Saving" : "I accept. Record my answers."}
      </Button>
      {error && <p className="mt-3 text-fail">{error}</p>}
    </div>
  );
}
