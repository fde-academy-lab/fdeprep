"use client";

/**
 * Issue a report card from the learner page. The dialog says what issuing
 * does before it does it: a new dated card beside any earlier one, which
 * never changes afterwards. The route's refusal shows inside the dialog.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DialogForm, post } from "@/components/ui/dialog";

export function IssueReportCard({ enrolmentId, variant = "secondary" }: {
  enrolmentId: number;
  variant?: "primary" | "secondary";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size="sm" variant={variant} onClick={() => setOpen(true)}>Issue a report card</Button>
      <DialogForm open={open} onClose={() => setOpen(false)} title="Issue a report card"
                  submitLabel="Issue" busyLabel="Issuing"
                  onSubmit={async () => {
                    await post(`/api/admin/learners/${enrolmentId}/report-cards`);
                    router.refresh();
                    return null;
                  }}>
        <p>
          A report card is a dated copy of this page for placement: readiness, competencies, the
          strongest submits, voice scores and what the card does not measure. It never changes once
          issued, and issuing again adds a new card beside this one.
        </p>
      </DialogForm>
    </>
  );
}
