/** Throw or clear degraded mode. Admin only, reason mandatory when turning it on. */
import { NextResponse } from "next/server";
import { ReasonRequired, toggleDegradedMode } from "@/lib/admin";
import { Forbidden, requireAdmin } from "@/lib/admin/guard";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const admin = await requireAdmin();
    const body = (await request.json()) as { on?: boolean; reason?: string };
    const mode = await toggleDegradedMode(body.on === true, body.reason ?? null, admin.userId);
    return NextResponse.json(mode);
  } catch (error) {
    if (error instanceof Forbidden || error instanceof ReasonRequired) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    throw error;
  }
}
