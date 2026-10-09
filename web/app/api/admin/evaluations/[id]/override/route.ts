/**
 * Correct a grade the panel got wrong. docs/00 section 3.1, docs/10 section 9.7.
 *
 * Faculty correct their own cohort's grades and admins any cohort's
 * (lib/session/records.ts). An evaluation outside that answers as one that
 * does not exist. Until 8 October 2026 faculty could correct any cohort's
 * (S15.13).
 */
import { NextResponse } from "next/server";
import { Forbidden, SignedOut, requireFaculty } from "@/lib/admin/guard";
import {
  NotOverridable, NoteRequired, UnknownBand, overrideBand,
} from "@/lib/eval/override";
import { signedOut } from "@/lib/http/failure";
import type { Band } from "@/lib/policy/bands";
import { readableEvaluation } from "@/lib/session/records";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request, { params }: { params: Promise<{ id: string }> },
) {
  try {
    const reviewer = await requireFaculty();
    const evaluationId = Number((await params).id);
    if (!(await readableEvaluation(reviewer, evaluationId))) throw NotOverridable.missing(evaluationId);
    const body = (await request.json()) as { band?: string; note?: string };

    const corrected = await overrideBand({
      evaluationId,
      reviewerId: reviewer.userId,
      band: body.band as Band,
      note: body.note ?? "",
    });
    return NextResponse.json({ evaluationId: corrected });
  } catch (error) {
    if (error instanceof SignedOut) return signedOut();
    if (error instanceof Forbidden || error instanceof NoteRequired ||
        error instanceof NotOverridable || error instanceof UnknownBand) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    throw error;
  }
}
