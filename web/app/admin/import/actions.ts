"use server";

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { previewImport, publishImport, type ImportPreview } from "@/lib/problems/import";
import { validateProblemYaml, type ValidationError } from "@/lib/problems/validate";
import { currentLearner } from "@/lib/session/current";

const ROOT = path.join(process.cwd(), "..", "problems");

export interface FileReport {
  file: string;
  errors: ValidationError[];
  preview: ImportPreview | null;
}

async function yamlFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await yamlFiles(full)));
    else if (entry.name.endsWith(".yaml")) found.push(full);
  }
  return found.sort();
}

/** What publishing would change, computed without writing anything. */
export async function previewAll(): Promise<FileReport[]> {
  const reports: FileReport[] = [];
  for (const file of await yamlFiles(ROOT)) {
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
  const learner = await currentLearner();
  if (learner.role !== "admin" && learner.role !== "faculty") {
    throw new Error("Only faculty and admins can publish a problem.");
  }

  let published = 0;
  let skipped = 0;
  for (const file of await yamlFiles(ROOT)) {
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
