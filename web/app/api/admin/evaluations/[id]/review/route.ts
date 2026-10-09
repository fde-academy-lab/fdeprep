/**
 * Record what a reviewer concluded about a panel disagreement. docs/10 section 9.7.
 *
 * Faculty settle their own cohort's disagreements and admins any cohort's
 * (lib/session/records.ts). An evaluation outside that answers as one that is
 * not a disagreement, which is what an id nobody holds gets. Until 8 October
 * 2026 faculty could settle any cohort's (S15.13).
 */
import { NextResponse } from "next/server";
import { Forbidden, SignedOut, requireFaculty } from "@/lib/admin/guard";
import {
  NoteRequired, NothingToReview, UnknownDisposition, recordReview,
  type Disposition,
} from "@/lib/eval/review";
import { signedOut } from "@/lib/http/failure";
import { readableEvaluation } from "@/lib/session/records";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request, { params }: { params: Promise<{ id: string }> },
) {
  try {
    const reviewer = await requireFaculty();
    const evaluationId = Number((await params).id);
    if (!(await readableEvaluation(reviewer, evaluationId))) throw new NothingToReview(evaluationId);
    const body = (await request.json()) as { disposition?: string; note?: string };

    await recordReview({
      evaluationId,
      reviewerId: reviewer.userId,
      disposition: body.disposition as Disposition,
      note: body.note ?? "",
    });
    return NextResponse.json({ reviewed: evaluationId });
  } catch (error) {
    if (error instanceof SignedOut) return signedOut();
    if (error instanceof Forbidden || error instanceof NoteRequired ||
        error instanceof NothingToReview || error instanceof UnknownDisposition) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    throw error;
  }
}
