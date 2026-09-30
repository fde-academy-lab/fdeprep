"use client";

/**
 * The bulk persona change.
 *
 * The file is parsed on the server, and a row that names an unknown persona or
 * a login outside the cohort is reported by line while the rest of the file
 * still applies. Rejecting 180 rows over one typo makes the operator edit a
 * spreadsheet at the moment they are trying to fix something.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

interface Result {
  changed: number;
  unchanged: number;
  errors: string[];
}

export default function Upload() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const upload = async (file: File) => {
    setBusy(true);
    setResult(null);
    const response = await fetch("/api/admin/roster", {
      method: "POST",
      headers: { "content-type": "text/csv" },
      body: await file.text(),
    });
    const body = (await response.json()) as Result & { message?: string };
    setResult(response.ok ? body : { changed: 0, unchanged: 0, errors: [body.message ?? "Failed."] });
    setBusy(false);
    router.refresh();
  };

  return (
    <section className="mb-4 rounded border border-border p-3">
      <h2 className="mb-1">Bulk persona change</h2>
      <p className="mb-2 text-text-dim">
        A CSV with a login column and a persona column. Every change is written to the audit
        log with your name on it.
      </p>
      <input type="file" accept=".csv,text/csv" disabled={busy}
             aria-label="Persona CSV"
             onChange={(event) => {
               const file = event.target.files?.[0];
               if (file) void upload(file);
             }} />

      {result ? (
        <div className="mt-2">
          <p className="tnum">
            {result.changed} changed, {result.unchanged} already correct.
          </p>
          {result.errors.length ? (
            <ul className="mt-1 text-warn">
              {result.errors.map((error) => <li key={error}>{error}</li>)}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
