/**
 * CI gate over voice-interviewers/ and voice-questions/. Same shape as
 * validate-problems.ts and for the same reason: a broken question fails in
 * front of a learner who is already speaking, and a spoken answer cannot be
 * recovered.
 *
 *   npm run validate:voice              every interviewer, then every question
 *   npm run validate:voice -- path...   just those question files, checked
 *                                       against every interviewer
 *
 * The interviewers come first because a question names them: the question
 * rules check every slug in `interviewers` against the files that exist, and
 * every slug in `builds_on` against the problem files under problems/.
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { validateInterviewerYaml } from "../lib/voice/validate-interviewer.ts";
import { validateVoiceYaml, type VoiceError } from "../lib/voice/validate-question.ts";

const REPO = path.join(import.meta.dirname, "..", "..");
const ROOT = path.join(REPO, "voice-questions");
const INTERVIEWERS = path.join(REPO, "voice-interviewers");
const PROBLEMS = path.join(REPO, "problems");

async function yamlFilesUnder(dir: string, skip: ReadonlySet<string> = new Set()): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!skip.has(entry.name)) found.push(...(await yamlFilesUnder(full, skip)));
    } else if (entry.name.endsWith(".yaml") || entry.name.endsWith(".yml")) {
      found.push(full);
    }
  }
  return found.sort();
}

/** Every problem slug, read from each file's `slug:` line. Fixtures are left
 *  out: they exist for the tests and no learner can open one. */
export async function problemSlugs(): Promise<Set<string>> {
  const slugs = new Set<string>();
  for (const file of await yamlFilesUnder(PROBLEMS, new Set(["_fixtures"]))) {
    const slug = /^slug:\s*(\S+)\s*$/m.exec(await readFile(file, "utf8"))?.[1];
    if (slug) slugs.add(slug);
  }
  return slugs;
}

function report(relative: string, errors: VoiceError[], failures: VoiceError[]): void {
  if (errors.length === 0) {
    console.log(`  ok    ${relative}`);
    return;
  }
  for (const error of errors) {
    console.error(`  FAIL  ${relative}:${error.line}  ${error.rule}: ${error.message}`);
  }
  failures.push(...errors);
}

/** Every interviewer file, and the slugs of the ones that exist. */
export async function validateAllInterviewers(): Promise<{ failures: VoiceError[]; slugs: Set<string> }> {
  const files = await yamlFilesUnder(INTERVIEWERS);
  const sources = await Promise.all(files.map((file) => readFile(file, "utf8")));
  const slugs = new Set(files.map((file) => path.basename(file).replace(/\.ya?ml$/, "")));
  const failures: VoiceError[] = [];
  const voices = new Map<string, string>();

  files.forEach((file, index) => {
    const relative = path.relative(REPO, file);
    const result = validateInterviewerYaml(sources[index]!, relative, { known: slugs });
    const errors = [...result.errors];
    // Distinct per person: two interviewers in one voice would be one
    // interviewer to a learner listening to a panel.
    const voice = /^voice:\s*\{\s*id:\s*(\w+)/m.exec(sources[index]!)?.[1];
    if (result.ok && voice) {
      const earlier = voices.get(voice);
      if (earlier) {
        errors.push({ rule: "voice", line: 1, file: relative,
                      message: `voice ${voice} is already ${earlier}'s, and each person speaks with their own` });
      } else {
        voices.set(voice, relative);
      }
    }
    report(relative, errors, failures);
  });
  return { failures, slugs };
}

export async function validateAllVoice(files?: string[]): Promise<VoiceError[]> {
  const interviewers = await validateAllInterviewers();
  const problems = await problemSlugs();
  const targets = files?.length ? files : await yamlFilesUnder(ROOT);
  const failures: VoiceError[] = [...interviewers.failures];
  const slugs = new Map<string, string>();

  for (const file of targets) {
    const relative = path.relative(REPO, file);
    const result = validateVoiceYaml(await readFile(file, "utf8"), relative,
                                     { interviewers: interviewers.slugs, problems });
    const errors = [...result.errors];
    if (result.ok && result.slug) {
      const earlier = slugs.get(result.slug);
      if (earlier) {
        errors.push({
          rule: "schema",
          message: `slug ${result.slug} is already used by ${earlier}, and a slug is how a ` +
                   "session names the question it was answering",
          line: 1,
          file: relative,
        });
      } else {
        slugs.set(result.slug, relative);
      }
    }
    report(relative, errors, failures);
  }
  return failures;
}

if (import.meta.filename === process.argv[1]) {
  const failures = await validateAllVoice(process.argv.slice(2).map((p) => path.resolve(p)));
  if (failures.length) {
    console.error(`\n${failures.length} voice file(s) failed validation.`);
    process.exit(1);
  }
  console.log("\nevery interviewer and every voice question validates.");
}
