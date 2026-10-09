/** Withdraw an invite nobody has used. Admin only, audited. */
import { NextResponse } from "next/server";
import { revokeInvite } from "@/lib/auth/invite";
import { Forbidden, SignedOut, requireAdmin } from "@/lib/admin/guard";
import { signedOut } from "@/lib/http/failure";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request, { params }: { params: Promise<{ id: string }> },
) {
  try {
    const admin = await requireAdmin();
    const { id } = await params;
    const withdrawn = await revokeInvite(Number(id), admin.userId);
    if (!withdrawn) {
      return NextResponse.json({
        message: "That invite was already used or withdrawn, so there is nothing to withdraw.",
      }, { status: 409 });
    }
    return NextResponse.json({ withdrawn: Number(id) });
  } catch (error) {
    if (error instanceof SignedOut) return signedOut();
    if (error instanceof Forbidden) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    throw error;
  }
}
