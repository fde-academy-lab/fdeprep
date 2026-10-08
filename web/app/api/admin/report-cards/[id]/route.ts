/**
 * Download one report card as Markdown. docs/11 sections 3 and 7.
 *
 * Rendered from the stored snapshot, so a card issued months ago downloads
 * saying what it said then, with its date and its hash. Faculty and admins,
 * and only a card from the viewer's cohort.
 */
import { Forbidden, requireFaculty } from "@/lib/admin/guard";
import { reportCard, reportCardMarkdown } from "@/lib/analytics/report-card";
import { publicOrigin } from "@/lib/http/public-url";

export const dynamic = "force-dynamic";

const plain = (body: string, status: number) =>
  new Response(`${body}\n`, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

export async function GET(
  request: Request, { params }: { params: Promise<{ id: string }> },
) {
  try {
    const viewer = await requireFaculty();
    const id = Number((await params).id);
    const card = Number.isInteger(id) ? await reportCard(id, viewer.cohortId) : null;
    if (!card) {
      return plain("There is no report card with that id in your cohort. Issue one from the " +
                   "learner's page.", 404);
    }
    const login = card.snapshot.learner.login.replace(/[^a-z0-9-]/gi, "-");
    const filename = `fdeprep-report-card-${login}-${card.generatedAt.slice(0, 10)}-` +
      `${card.sha256.slice(0, 8)}.md`;
    return new Response(reportCardMarkdown(card, { origin: publicOrigin(request.url) }), {
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    if (error instanceof Forbidden) return plain(error.message, error.status);
    throw error;
  }
}
