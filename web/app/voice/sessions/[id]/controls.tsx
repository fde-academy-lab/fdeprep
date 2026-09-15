"use client";

/**
 * The two things docs/07 section 9 gives a learner over their own recording:
 * delete it, and choose whether faculty can hear it.
 *
 * Both are the learner's alone. Neither touches a score, and the copy says so
 * before the button rather than after, because the promise is the reason
 * somebody will press it.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

export function AudioControls({
  sessionId,
  available,
  deletedAt,
  shared,
  retentionDays,
}: {
  sessionId: number;
  available: boolean;
  deletedAt: string | null;
  shared: boolean;
  retentionDays: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(path: string, method: string, body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(path, {
        method,
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) {
        const payload = (await response.json()) as { message?: string };
        setError(payload.message ?? "That did not work. Try again.");
        return;
      }
      router.refresh();
    } catch {
      setError("That did not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  if (deletedAt) {
    return (
      <p className="text-text-dim">
        You deleted this recording on {new Date(deletedAt).toLocaleDateString()}. Your score,
        your transcript and your beats are unchanged.
      </p>
    );
  }

  if (!available) {
    return (
      <p className="text-text-dim">
        No recording was stored for this session. The replay above runs on its own clock.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-text-dim">
        Recordings are kept for {retentionDays} days and then deleted. Your transcript and
        your score stay after the audio is gone.
      </p>

      <div>
        <label className="flex items-baseline gap-2">
          <input
            type="checkbox"
            checked={shared}
            disabled={busy}
            onChange={(event) =>
              void call(`/api/voice/sessions/${sessionId}/share`, "POST", {
                shared: event.target.checked,
              })
            }
          />
          <span>Let faculty hear this one session.</span>
        </label>
        <p className="mt-1 text-text-faint">
          Faculty always see your transcript and your score. They cannot hear a recording
          unless you tick this, one session at a time, and you can untick it later.
        </p>
      </div>

      <div>
        {confirming ? (
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => void call(`/api/voice/sessions/${sessionId}/audio`, "DELETE")}
              className="rounded border border-fail px-3 py-1.5 text-fail hover:bg-surface-2
                         disabled:opacity-50"
            >
              Delete it permanently
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="text-text-dim hover:text-text"
            >
              Keep it
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirming(true)}
            className="rounded border border-border px-3 py-1.5 text-text-dim hover:text-text
                       disabled:opacity-50"
          >
            Delete this recording
          </button>
        )}
        <p className="mt-1 text-text-faint">
          Deletion is immediate and cannot be undone. Your score for this session stays.
        </p>
      </div>

      {error && <p className="text-fail">{error}</p>}
    </div>
  );
}
