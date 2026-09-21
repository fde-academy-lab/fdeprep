/** Correct a grade the panel got wrong. docs/00 section 3.1, docs/10 section 9.7. */
import { NextResponse } from "next/server";
import { Forbidden, requireFaculty } from "@/lib/admin/guard";
import {
  NotOverridable, NoteRequired, UnknownBand, overrideBand,
} from "@/lib/eval/override";
import type { Band } from "@/lib/policy/bands";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request, { params }: { params: Promise<{ id: string }> },
) {
  try {
    const reviewer = await requireFaculty();
    const { id } = await params;
    const body = (await request.json()) as { band?: string; note?: string };

    const evaluationId = await overrideBand({
      evaluationId: Number(id),
      reviewerId: reviewer.userId,
      band: body.band as Band,
      note: body.note ?? "",
    });
    return NextResponse.json({ evaluationId });
  } catch (error) {
    if (error instanceof Forbidden || error instanceof NoteRequired ||
        error instanceof NotOverridable || error instanceof UnknownBand) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    throw error;
  }
}
