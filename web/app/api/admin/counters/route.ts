/** Clear a rate limit counter. Admin only, reason mandatory, written to audit_log. */
import { NextResponse } from "next/server";
import { clearCounter, COUNTER_SCOPES, enrolmentByLogin, ReasonRequired } from "@/lib/admin";
import { Forbidden, requireAdmin } from "@/lib/admin/guard";
import type { Scope } from "@/lib/policy";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const admin = await requireAdmin();
    const body = (await request.json()) as
      { login?: unknown; scope?: string; problemId?: number; reason?: string };
    const login = typeof body.login === "string" ? body.login.trim() : "";

    if (!login || !COUNTER_SCOPES.includes(body.scope as Scope)) {
      return NextResponse.json(
        { message: `Needs a GitHub login and one of ${COUNTER_SCOPES.join(", ")}.` }, { status: 400 });
    }

    // Resolved here, in the admin's cohort, so the browser never names an enrolment.
    const enrolmentId = await enrolmentByLogin(login, admin.cohortId);
    if (enrolmentId === null) {
      return NextResponse.json(
        { message: `${login} is not enrolled in this cohort, so nothing was cleared. ` +
                   "Check the login on the Roster." }, { status: 404 });
    }

    const cleared = await clearCounter(
      { enrolmentId, scope: body.scope as Scope, problemId: body.problemId },
      body.reason ?? "", admin.userId);
    return NextResponse.json({ cleared });
  } catch (error) {
    if (error instanceof Forbidden || error instanceof ReasonRequired) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    throw error;
  }
}
