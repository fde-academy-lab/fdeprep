/**
 * The cohort standing as CSV, the export behind the Overview. docs/11
 * sections 4 and 7.
 *
 * Faculty and admins only (docs/11 section 8: one learner never sees another
 * learner's standing). The cohort is the viewer's, read from the session, so
 * nobody exports another cohort by changing the address. A learner who asks
 * is refused in a sentence that names who can see it, which is docs/11
 * acceptance 7.
 */
import { Forbidden, requireFaculty } from "@/lib/admin/guard";
import { standingCsv } from "@/lib/analytics/standing";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const viewer = await requireFaculty();
    const standing = await standingCsv(viewer.cohortId);
    return new Response(standing.body, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${standing.filename}"`,
      },
    });
  } catch (error) {
    if (error instanceof Forbidden) {
      return new Response(
        "The cohort standing is for faculty and admins. Your own readiness is on Progress.\n",
        { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    throw error;
  }
}
