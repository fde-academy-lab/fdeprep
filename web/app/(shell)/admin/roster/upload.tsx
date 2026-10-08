"use client";

/**
 * The bulk persona change, as a dialog opened from the Roster's heading row.
 *
 * The file is parsed on the server, and a row that names an unknown persona or
 * a login outside the cohort is reported by line while the rest of the file
 * still applies. Rejecting 180 rows over one typo makes the operator edit a
 * spreadsheet at the moment they are trying to fix something.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DialogForm, refusal, request } from "@/components/ui/dialog";
import { FileInput } from "@/components/ui/field";

interface Result {
  changed: number;
  unchanged: number;
  errors: string[];
}

export function PersonaUpload() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)}>Change personas from a CSV</Button>
      <DialogForm open={open} onClose={() => setOpen(false)} title="Change personas from a CSV"
                  submitLabel="Apply"
                  onSubmit={async (data) => {
                    const file = data.get("csv");
                    const { response, data: body } = await request("/api/admin/roster", {
                      method: "POST",
                      headers: { "content-type": "text/csv" },
                      body: file instanceof File ? await file.text() : "",
                    });
                    // A file with nothing to apply comes back refused, with its errors by line,
                    // and those lines are the result the operator needs to see.
                    if (!body || !Array.isArray(body["errors"])) throw refusal(response, body);
                    router.refresh();
                    const result = body as unknown as Result;
                    return (
                      <div className="space-y-2">
                        <p className="tnum">{result.changed} changed, {result.unchanged} already correct.</p>
                        {result.errors.length ? (
                          <ul className="space-y-1 text-fail">
                            {result.errors.map((error) => <li key={error}>{error}</li>)}
                          </ul>
                        ) : null}
                      </div>
                    );
                  }}>
        <p>
          A CSV with a login column and a persona column. Every change is written to the audit log
          with your name on it.
        </p>
        <FileInput name="csv" accept=".csv,text/csv" required />
      </DialogForm>
    </>
  );
}
