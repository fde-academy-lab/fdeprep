/**
 * The cohort standing as CSV. docs/11 sections 4 and 7.
 *
 * The programme manager's spreadsheet is where cohort decisions get made, so
 * the Overview's rows go there as they are: readiness with its four counts and
 * band (docs/12 section 2), the interview coverage beside it (docs/12 section
 * 5), last activity and the stuck count. Every number comes from the function
 * the screens read it from, so the export cannot disagree with the Overview.
 *
 * docs/11 section 7: every export carries the date it was generated and the
 * count of rows it covers. A CSV has no place for either, so the first line
 * is a comment carrying both, written without commas so a spreadsheet keeps
 * it in one cell and a reader that skips lines starting with # skips it.
 * docs/07 section 6: delivery is never exported, and no column carries it.
 */
import type { Pool, PoolClient } from "pg";
import { db } from "../db/pool.ts";
import { overview } from "../admin/overview.ts";
import { coverageForMany } from "../progress/coverage.ts";

const HEADER = [
  "login", "name", "persona", "state", "readiness", "band", "clean", "passed", "attempted",
  "untouched", "required", "practised", "written", "oral", "last_activity", "stuck",
];

export interface StandingExport {
  filename: string;
  body: string;
  rows: number;
}

export async function standingCsv(
  cohortId: number, client: Pool | PoolClient = db(), now: Date = new Date(),
): Promise<StandingExport> {
  const [{ rows }, { rows: [cohort] }] = await Promise.all([
    overview(cohortId, client),
    client.query<{ slug: string }>("select slug from cohort where id = $1", [cohortId]),
  ]);
  const coverage = await coverageForMany(rows.map((row) => row.enrolmentId), client);
  const slug = cohort?.slug ?? String(cohortId);

  const lines = [...rows].sort((a, b) => a.login.localeCompare(b.login)).map((row) => {
    const readiness = row.readiness;
    const covered = coverage.get(row.enrolmentId);
    return [
      row.login, row.displayName, row.persona, row.state,
      readiness ? String(readiness.percent) : "", readiness?.band ?? "",
      readiness ? String(readiness.clean) : "", readiness ? String(readiness.passed) : "",
      readiness ? String(readiness.attempted) : "", readiness ? String(readiness.untouched) : "",
      readiness ? String(readiness.required) : "",
      String(covered?.practised ?? 0), String(covered?.written ?? 0), String(covered?.oral ?? 0),
      row.lastActivity ?? "", String(row.stuck),
    ].map(csvField).join(",");
  });

  const generated = now.toISOString();
  const preamble = `# Cohort standing for ${slug.replace(/[",\n\r]/g, " ")} generated ${generated} ` +
    `covering ${rows.length} learners`;
  return {
    filename: `fdeprep-standing-${slug.replace(/[^a-z0-9-]/gi, "-")}-${generated.slice(0, 10)}.csv`,
    body: [preamble, HEADER.join(","), ...lines].join("\n") + "\n",
    rows: rows.length,
  };
}

/** The quoting rule historyCsv uses, applied to every field. */
function csvField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
