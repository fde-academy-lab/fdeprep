/** Clear a rate limit counter. Admin only, reason mandatory, written to audit_log. */
import { NextResponse } from "next/server";
import { clearCounter, ReasonRequired } from "@/lib/admin";
import { Forbidden, requireAdmin } from "@/lib/admin/guard";
import type { Scope } from "@/lib/policy";

export const dynamic = "force-dynamic";

const SCOPES: Scope[] = [
  "run_hourly", "submit_daily", "live_daily", "rehearsal_weekly", "defence_daily",
];

export async function POST(request: Request) {
  try {
    const admin = await requireAdmin();
    const body = (await request.json()) as
      { enrolmentId?: number; scope?: string; problemId?: number; reason?: string };

    if (!body.enrolmentId || !SCOPES.includes(body.scope as Scope)) {
      return NextResponse.json(
        { message: `Needs an enrolmentId and one of ${SCOPES.join(", ")}.` }, { status: 400 });
    }

    const cleared = await clearCounter(
      { enrolmentId: body.enrolmentId, scope: body.scope as Scope, problemId: body.problemId },
      body.reason ?? "", admin.userId);
    return NextResponse.json({ cleared });
  } catch (error) {
    if (error instanceof Forbidden || error instanceof ReasonRequired) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    throw error;
  }
}
