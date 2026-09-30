/**
 * Create an invite. Admin only, audited, and the link is returned once:
 * only its hash is stored, so a lost link is replaced, never looked up.
 */
import { NextResponse } from "next/server";
import { createInvite, InviteInvalid, type InvitePersona, type InviteRole } from "@/lib/auth/invite";
import { Forbidden, requireAdmin } from "@/lib/admin/guard";
import { publicUrl } from "@/lib/http/public-url";

export const dynamic = "force-dynamic";

interface Body {
  githubLogin?: string;
  role?: InviteRole;
  persona?: InvitePersona;
  expiresInDays?: number;
  note?: string;
}

export async function POST(request: Request) {
  try {
    const admin = await requireAdmin();
    const body = (await request.json().catch(() => ({}))) as Body;
    const created = await createInvite({
      cohortId: admin.cohortId,
      actorId: admin.userId,
      githubLogin: body.githubLogin ?? null,
      role: body.role,
      persona: body.persona,
      expiresInDays: body.expiresInDays === undefined ? undefined : Number(body.expiresInDays),
      note: body.note ?? null,
    });
    return NextResponse.json({
      id: created.id,
      url: publicUrl(`/invite/${created.token}`, request.url).toString(),
      expiresAt: created.expiresAt,
    }, { status: 201 });
  } catch (error) {
    if (error instanceof Forbidden || error instanceof InviteInvalid) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    throw error;
  }
}
