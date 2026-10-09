"use server";

/**
 * The import screen's two server actions. Admin only (docs/00 section 2,
 * docs/10 section 9.7: the import screen stays admin only, and permits is the
 * one place that decides).
 *
 * Every exported function in this file is an endpoint a browser can call, so
 * each checks the session and the role itself. Next's guidance is to verify
 * inside every server function rather than rely on the page or the proxy.
 * Until 8 October 2026 previewAll checked nothing and publishAll let faculty
 * publish (S15.13).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { Forbidden, permits } from "@/lib/admin/guard";
import { previewImport, publishImport, type ImportPreview } from "@/lib/problems/import";
import { publishableYamlFiles } from "@/lib/problems/source";
import { validateProblemYaml, type ValidationError } from "@/lib/problems/validate";
import { currentLearner, type Learner } from "@/lib/session/current";

const ROOT = path.join(process.cwd(), "..", "problems");

/** The signed-in admin, or a refusal that names who may do this. */
async function admin(): Promise<Learner> {
  const learner = await currentLearner();
  if (!permits(learner.role, "admin")) throw new Forbidden();
  return learner;
}

export interface FileReport {
  file: string;
  errors: ValidationError[];
  preview: ImportPreview | null;
}

/** What publishing would change, computed without writing anything. */
export async function previewAll(): Promise<FileReport[]> {
  await admin();
  const reports: FileReport[] = [];
  for (const file of await publishableYamlFiles(ROOT)) {
    const relative = path.relative(path.join(ROOT, ".."), file);
    const source = await readFile(file, "utf8");
    const report = validateProblemYaml(source, relative);
    reports.push({
      file: relative,
      errors: report.errors,
      preview: report.problem ? await previewImport(report.problem, source) : null,
    });
  }
  return reports;
}

export async function publishAll(): Promise<{ published: number; skipped: number }> {
  const learner = await admin();

  let published = 0;
  let skipped = 0;
  for (const file of await publishableYamlFiles(ROOT)) {
    const relative = path.relative(path.join(ROOT, ".."), file);
    const source = await readFile(file, "utf8");
    const report = validateProblemYaml(source, relative);
    // A file that does not validate is never written. CI should have caught it
    // first; this is the second gate, not the only one.
    if (!report.problem) { skipped += 1; continue; }
    const result = await publishImport(report.problem, source,
      { publish: true, actorId: learner.userId });
    if (result.action === "unchanged") skipped += 1;
    else published += 1;
  }
  revalidatePath("/problems");
  revalidatePath("/admin/import");
  return { published, skipped };
}
