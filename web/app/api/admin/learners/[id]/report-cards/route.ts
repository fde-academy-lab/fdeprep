/**
 * Issue a report card for one learner. docs/11 section 3, story S15.6.
 *
 * Faculty and admins, for a learner in their own cohort. Each call appends a
 * new card and changes none that exist, so issuing twice is safe and leaves
 * two dated rows. The issuer comes from the session, never from the request.
 */
import { NextResponse } from "next/server";
import { Forbidden, requireFaculty } from "@/lib/admin/guard";
import { learnerFacts } from "@/lib/admin/overview";
import { issueReportCard } from "@/lib/analytics/report-card";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request, { params }: { params: Promise<{ id: string }> },
) {
  try {
    const viewer = await requireFaculty();
    const id = Number((await params).id);
    const learner = Number.isInteger(id) ? await learnerFacts(id, viewer.cohortId) : null;
    if (!learner) {
      return NextResponse.json(
        { message: "There is no learner with that id in your cohort. Open them from the Overview." },
        { status: 404 });
    }
    const card = await issueReportCard({ enrolmentId: learner.enrolmentId, issuedBy: viewer.userId });
    return NextResponse.json({ id: card.id, sha256: card.sha256, generatedAt: card.generatedAt });
  } catch (error) {
    if (error instanceof Forbidden) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    throw error;
  }
}
