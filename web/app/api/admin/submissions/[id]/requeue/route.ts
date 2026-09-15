/** Requeue a stuck submission. docs/05 section 7, the first runbook procedure. */
import { NextResponse } from "next/server";
import { NotApplicable, ReasonRequired, requeueSubmission } from "@/lib/admin";
import { Forbidden, requireAdmin } from "@/lib/admin/guard";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request, { params }: { params: Promise<{ id: string }> },
) {
  try {
    const admin = await requireAdmin();
    const { id } = await params;
    const body = (await request.json()) as { reason?: string };

    await requeueSubmission(Number(id), body.reason ?? "", admin.userId);
    return NextResponse.json({ requeued: Number(id) });
  } catch (error) {
    if (error instanceof Forbidden || error instanceof ReasonRequired ||
        error instanceof NotApplicable) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    throw error;
  }
}
