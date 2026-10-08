"use client";

/**
 * Inviting a tester, and withdrawing an invite nobody has used.
 *
 * The link is shown once, when it is made. Only its hash is stored, so a lost
 * link is replaced by a new invite rather than looked up, and the old one is
 * withdrawn from the table below.
 */
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, type ButtonSize } from "@/components/ui/button";
import { DialogForm, post } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";

/** The Overview's empty state links here with this, to open the dialog on arrival. */
const OPEN_ON = "#invite";

export function InviteDialog({ size }: { size?: ButtonSize }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (window.location.hash !== OPEN_ON) return;
    // Clear the address first, so a reload does not open the dialog again.
    history.replaceState(null, "", window.location.pathname + window.location.search);
    setOpen(true);
  }, []);

  return (
    <>
      <Button variant="primary" size={size} onClick={() => setOpen(true)}>Invite a tester</Button>
      <DialogForm open={open} onClose={() => setOpen(false)} title="Invite a tester"
                  submitLabel="Make the link" busyLabel="Making the link"
                  onSubmit={async (data) => {
                    const created = await post<{ url: string; expiresAt: string }>("/api/admin/invites", {
                      githubLogin: String(data.get("githubLogin") ?? ""),
                      role: String(data.get("role") ?? "learner"),
                      persona: String(data.get("persona") ?? "navigator"),
                      expiresInDays: Number(data.get("expiresInDays") ?? 14),
                      note: String(data.get("note") ?? ""),
                    });
                    router.refresh();
                    return <Created url={created.url} expiresAt={created.expiresAt} />;
                  }}>
        <p>
          Makes a one-time link to send yourself. Whoever signs in with GitHub through it joins
          this cohort. Name a GitHub login to make it work for that account only.
        </p>
        <div className="grid grid-cols-2 gap-4">
          <Field label="GitHub login (optional)">
            <Input name="githubLogin" autoComplete="off" spellCheck={false} />
          </Field>
          <Field label="Role">
            <Select name="role" defaultValue="learner">
              <option value="learner">learner</option>
              <option value="faculty">faculty</option>
              <option value="admin">admin</option>
            </Select>
          </Field>
          <Field label="Persona">
            <Select name="persona" defaultValue="navigator">
              <option value="builder">builder</option>
              <option value="navigator">navigator</option>
              <option value="accelerator">accelerator</option>
            </Select>
          </Field>
          <Field label="Days it lasts">
            <Input name="expiresInDays" type="number" min={1} max={90} step={1} defaultValue={14} required />
          </Field>
          <Field label="Who it is for (admins only see this)" className="col-span-2">
            <Input name="note" maxLength={200} />
          </Field>
        </div>
      </DialogForm>
    </>
  );
}

/** The link, once, with a way to copy it. */
function Created({ url, expiresAt }: { url: string; expiresAt: string }) {
  const [copied, setCopied] = useState(false);
  const until = new Date(expiresAt).toLocaleDateString("en-GB",
    { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded-control border border-border bg-bg py-1 pl-3 pr-1">
        <code className="min-w-0 flex-1 truncate font-mono text-meta text-text">{url}</code>
        <Button size="sm" onClick={() => void navigator.clipboard.writeText(url).then(() => setCopied(true))}>
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <p className="text-text-dim">
        Send this link yourself. It is shown once and works once, until {until}.
      </p>
    </div>
  );
}

export function Withdraw({ inviteId }: { inviteId: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>Withdraw</Button>
      <DialogForm open={open} onClose={() => setOpen(false)} title="Withdraw"
                  submitLabel="Withdraw" cancelLabel="Keep it" submitVariant="danger"
                  onSubmit={async () => {
                    await post(`/api/admin/invites/${inviteId}/revoke`);
                    router.refresh();
                    return null;
                  }}>
        <p>Withdraw this invite? The link stops working at once.</p>
      </DialogForm>
    </>
  );
}
