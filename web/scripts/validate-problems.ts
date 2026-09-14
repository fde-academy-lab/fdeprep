/**
 * CI gate over problems/. A broken problem must never reach the import screen,
 * so this runs on every push rather than at import time.
 *
 *   npm run validate:problems            every problem in problems/
 *   npm run validate:problems -- path...  just those files
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { validateProblemYaml, type ValidationError } from "../lib/problems/validate.ts";

const ROOT = path.join(import.meta.dirname, "..", "..", "problems");

async function yamlFilesUnder(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await yamlFilesUnder(full)));
    else if (entry.name.endsWith(".yaml") || entry.name.endsWith(".yml")) found.push(full);
  }
  return found.sort();
}

export async function validateAll(files?: string[]): Promise<ValidationError[]> {
  const targets = files?.length ? files : await yamlFilesUnder(ROOT);
  const failures: ValidationError[] = [];
  for (const file of targets) {
    const relative = path.relative(path.join(ROOT, ".."), file);
    const report = validateProblemYaml(await readFile(file, "utf8"), relative);
    if (report.ok) {
      console.log(`  ok    ${relative}`);
    } else {
      for (const error of report.errors) {
        console.error(`  FAIL  ${relative}:${error.line}  ${error.rule}: ${error.message}`);
      }
      failures.push(...report.errors);
    }
  }
  return failures;
}

if (import.meta.filename === process.argv[1]) {
  const failures = await validateAll(process.argv.slice(2).map((p) => path.resolve(p)));
  if (failures.length) {
    console.error(`\n${failures.length} problem(s) failed validation.`);
    process.exit(1);
  }
  console.log("\nevery problem validates.");
}
