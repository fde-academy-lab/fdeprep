/**
 * The calibration report as Markdown, for the author before the next cohort.
 * docs/11 sections 5 and 7. Faculty and admins only, like the screen.
 */
import { Forbidden, SignedOut, requireFaculty } from "@/lib/admin/guard";
import { signedOut } from "@/lib/http/failure";
import { calibrationMarkdown, calibrationReport } from "@/lib/analytics/calibration";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireFaculty();
    const report = await calibrationReport();
    return new Response(calibrationMarkdown(report), {
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "content-disposition":
          `attachment; filename="fdeprep-calibration-${report.generatedAt.slice(0, 10)}.md"`,
      },
    });
  } catch (error) {
    if (error instanceof SignedOut) return signedOut();
    if (error instanceof Forbidden) {
      return new Response(
        "The calibration report is for faculty and admins. Ask your cohort lead if you need it.\n",
        { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    throw error;
  }
}
