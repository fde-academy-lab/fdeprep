/**
 * CI gate over voice-questions/. Same shape as validate-problems.ts and for
 * the same reason: a broken question fails in front of a learner who is
 * already speaking, and a spoken answer cannot be recovered.
 *
 *   npm run validate:voice              every question in voice-questions/
 *   npm run validate:voice -- path...   just those files
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { validateVoiceYaml, type VoiceError } from "../lib/voice/validate-question.ts";

const ROOT = path.join(import.meta.dirname, "..", "..", "voice-questions");

async function yamlFilesUnder(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await yamlFilesUnder(full)));
    else if (entry.name.endsWith(".yaml") || entry.name.endsWith(".yml")) found.push(full);
  }
  return found.sort();
}

export async function validateAllVoice(files?: string[]): Promise<VoiceError[]> {
  const targets = files?.length ? files : await yamlFilesUnder(ROOT);
  const failures: VoiceError[] = [];
  const slugs = new Map<string, string>();

  for (const file of targets) {
    const relative = path.relative(path.join(ROOT, ".."), file);
    const report = validateVoiceYaml(await readFile(file, "utf8"), relative);
    if (report.ok) {
      const earlier = report.slug ? slugs.get(report.slug) : undefined;
      if (report.slug && earlier) {
        const clash: VoiceError = {
          rule: "schema",
          message: `slug ${report.slug} is already used by ${earlier}, and a slug is how a ` +
                   "session names the question it was answering",
          line: 1,
          file: relative,
        };
        console.error(`  FAIL  ${relative}:1  ${clash.rule}: ${clash.message}`);
        failures.push(clash);
        continue;
      }
      if (report.slug) slugs.set(report.slug, relative);
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
  const failures = await validateAllVoice(process.argv.slice(2).map((p) => path.resolve(p)));
  if (failures.length) {
    console.error(`\n${failures.length} voice question(s) failed validation.`);
    process.exit(1);
  }
  console.log("\nevery voice question validates.");
}
