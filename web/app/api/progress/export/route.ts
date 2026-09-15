/**
 * The CSV export behind S9.
 *
 * docs/00 section 8: export is CSV, because the cohort trackers live in
 * spreadsheets. The enrolment comes from the session and never from the query
 * string, so one learner cannot export another's history by changing a number.
 */
import { historyCsv } from "@/lib/progress";
import { currentLearner } from "@/lib/session/current";

export const dynamic = "force-dynamic";

export async function GET() {
  const learner = await currentLearner();
  const csv = await historyCsv(learner.enrolmentId);
  const day = new Date().toISOString().slice(0, 10);

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="fdeprep-attempts-${day}.csv"`,
    },
  });
}
