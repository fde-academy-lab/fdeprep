/** Record what a reviewer concluded about a panel disagreement. docs/10 section 9.7. */
import { NextResponse } from "next/server";
import { Forbidden, requireFaculty } from "@/lib/admin/guard";
import {
  NoteRequired, NothingToReview, UnknownDisposition, recordReview,
  type Disposition,
} from "@/lib/eval/review";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request, { params }: { params: Promise<{ id: string }> },
) {
  try {
    const reviewer = await requireFaculty();
    const { id } = await params;
    const body = (await request.json()) as { disposition?: string; note?: string };

    await recordReview({
      evaluationId: Number(id),
      reviewerId: reviewer.userId,
      disposition: body.disposition as Disposition,
      note: body.note ?? "",
    });
    return NextResponse.json({ reviewed: Number(id) });
  } catch (error) {
    if (error instanceof Forbidden || error instanceof NoteRequired ||
        error instanceof NothingToReview || error instanceof UnknownDisposition) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    throw error;
  }
}
