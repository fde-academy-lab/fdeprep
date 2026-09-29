"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

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
        <p className="text-pass">
          You accepted on {grantedAt ? new Date(grantedAt).toLocaleDateString() : "an earlier day"}.
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => void call("DELETE")}
          className="mt-3 rounded border border-border px-3 py-1.5 text-text-dim
                     hover:text-text disabled:opacity-50"
        >
          Withdraw consent
        </button>
        <p className="mt-2 text-text-faint">
          Withdrawing stops new sessions. It does not delete recordings you already made; each
          session has its own delete button.
        </p>
        {error && <p className="mt-3 text-fail">{error}</p>}
      </div>
    );
  }

  return (
    <div className="mt-6">
      <button
        type="button"
        disabled={busy}
        onClick={() => void call("POST")}
        className="rounded border border-accent px-4 py-2 text-accent hover:bg-surface
                   disabled:opacity-50"
      >
        {busy ? "Saving" : "I accept. Record my answers."}
      </button>
      {error && <p className="mt-3 text-fail">{error}</p>}
    </div>
  );
}
