"use client";

/**
 * Inviting a tester, and withdrawing an invite nobody has used.
 *
 * The link is shown once, when it is made. Only its hash is stored, so a lost
 * link is replaced by a new invite rather than looked up, and the old one is
 * withdrawn from the table below.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

interface Created {
  url: string;
  expiresAt: string;
}

const field = "rounded border border-border bg-bg px-2 py-1";

export function InviteForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = async (form: HTMLFormElement) => {
    const data = new FormData(form);
    setBusy(true);
    setError(null);
    setCreated(null);
    setCopied(false);
    const response = await fetch("/api/admin/invites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        githubLogin: String(data.get("githubLogin") ?? ""),
        role: String(data.get("role") ?? "learner"),
        persona: String(data.get("persona") ?? "navigator"),
        expiresInDays: Number(data.get("expiresInDays") ?? 14),
        note: String(data.get("note") ?? ""),
      }),
    });
    const body = (await response.json().catch(() => ({}))) as Partial<Created> & { message?: string };
    if (response.ok && body.url && body.expiresAt) {
      setCreated({ url: body.url, expiresAt: body.expiresAt });
      form.reset();
    } else {
      setError(body.message ?? "The invite was not created. Try again.");
    }
    setBusy(false);
    router.refresh();
  };

  return (
    <section className="mb-4 rounded border border-border p-3">
      <h2 className="mb-1">Invite a tester</h2>
      <p className="mb-2 text-text-dim">
        Makes a one-time link to send yourself. Whoever signs in with GitHub through it joins
        this cohort. Name a GitHub login to make it work for that account only.
      </p>
      <form className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => { event.preventDefault(); void submit(event.currentTarget); }}>
        <label className="flex flex-col gap-1">
          <span className="text-text-dim">GitHub login (optional)</span>
          <input name="githubLogin" className={field} autoComplete="off" spellCheck={false} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-text-dim">Role</span>
          <select name="role" defaultValue="learner" className={field}>
            <option value="learner">learner</option>
            <option value="faculty">faculty</option>
            <option value="admin">admin</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-text-dim">Persona</span>
          <select name="persona" defaultValue="navigator" className={field}>
            <option value="builder">builder</option>
            <option value="navigator">navigator</option>
            <option value="accelerator">accelerator</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-text-dim">Days it lasts</span>
          <input name="expiresInDays" type="number" min={1} max={90} defaultValue={14}
                 className={`${field} w-24`} />
        </label>
        <label className="flex min-w-48 flex-1 flex-col gap-1">
          <span className="text-text-dim">Who it is for (admins only see this)</span>
          <input name="note" maxLength={200} className={field} />
        </label>
        <button type="submit" disabled={busy}
                className="rounded border border-border px-3 py-1 hover:border-accent disabled:opacity-40">
          {busy ? "Making the link" : "Make the link"}
        </button>
      </form>

      {created ? (
        <div className="mt-3 rounded border border-accent/40 p-2">
          <p className="text-text-dim">
            Send this link yourself. It is shown once and works once, until
            {" "}{created.expiresAt.slice(0, 10)}.
          </p>
          <div className="mt-1 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate font-mono">{created.url}</code>
            <button type="button"
                    onClick={() => void navigator.clipboard.writeText(created.url).then(() => setCopied(true))}
                    className="rounded border border-border px-2 py-1 hover:border-accent">
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      ) : null}
      {error ? <p className="mt-2 text-warn">{error}</p> : null}
    </section>
  );
}

export function Withdraw({ inviteId }: { inviteId: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const withdraw = async () => {
    if (!confirm("Withdraw this invite? The link stops working at once.")) return;
    setBusy(true);
    const response = await fetch(`/api/admin/invites/${inviteId}/revoke`, { method: "POST" });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { message?: string };
      alert(body.message ?? "That did not go through. Try again.");
    }
    setBusy(false);
    router.refresh();
  };

  return (
    <button type="button" onClick={withdraw} disabled={busy}
            className="rounded border border-border px-2 py-1 hover:border-accent disabled:opacity-40">
      {busy ? "Withdrawing" : "Withdraw"}
    </button>
  );
}
