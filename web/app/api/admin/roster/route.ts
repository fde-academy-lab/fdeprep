/** Bulk persona change from a CSV. Admin only, every change audited. */
import { NextResponse } from "next/server";
import { applyPersonaCsv, parsePersonaCsv } from "@/lib/admin";
import { Forbidden, requireAdmin } from "@/lib/admin/guard";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const admin = await requireAdmin();
    const parsed = parsePersonaCsv(await request.text());
    if (!parsed.rows.length) {
      return NextResponse.json({ changed: 0, unchanged: 0, errors: parsed.errors },
        { status: parsed.errors.length ? 400 : 200 });
    }

    const result = await applyPersonaCsv(parsed.rows, {
      actorId: admin.userId, cohortId: admin.cohortId,
    });
    return NextResponse.json({ ...result, errors: [...parsed.errors, ...result.errors] });
  } catch (error) {
    if (error instanceof Forbidden) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    throw error;
  }
}
