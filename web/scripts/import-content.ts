/**
 * Publish the authored content into the database.
 *
 *   npm run import:content
 *
 * Run it where the repository is: your machine, or the box the worker runs on.
 * It needs DATABASE_URL and nothing else.
 *
 * This exists because /admin/import reads problems/ from disk at request time,
 * which is fine on a machine holding the repository and impossible on Vercel.
 * A production build there traced 176 files for that route and none of the
 * problem YAML, and Next refuses an outputFileTracingIncludes glob that leaves
 * the project root, so the directory cannot be made to ship. Publishing content
 * is an operator action rather than a web request.
 *
 * Safe to run repeatedly. Every change to a YAML file is picked up on the next
 * run, and nothing is duplicated.
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { closeDb } from "../lib/db/pool.ts";
import { publishImport } from "../lib/problems/import.ts";
import { publishableYamlFiles } from "../lib/problems/source.ts";
import { validateProblemYaml } from "../lib/problems/validate.ts";
import { importVoiceQuestion } from "../lib/voice/import.ts";
import { importInterviewers } from "../lib/voice/import-interviewers.ts";

const REPO = path.join(import.meta.dirname, "..", "..");
const PROBLEMS = path.join(REPO, "problems");
const VOICE = path.join(REPO, "voice-questions");
const INTERVIEWERS = path.join(REPO, "voice-interviewers");

export interface ImportReport {
  problems: number;
  interviewers: number;
  voiceQuestions: number;
}

/** Every file in voice-interviewers/, read for one import. */
export async function interviewerFiles(): Promise<Array<{ source: string; file: string }>> {
  const names = (await readdir(INTERVIEWERS)).filter((name) => /\.ya?ml$/.test(name)).sort();
  return Promise.all(names.map(async (name) => ({
    source: await readFile(path.join(INTERVIEWERS, name), "utf8"),
    file: path.relative(REPO, path.join(INTERVIEWERS, name)),
  })));
}

export async function importAllContent(
  log: (line: string) => void = console.log,
): Promise<ImportReport> {
  let problems = 0;
  for (const file of await publishableYamlFiles(PROBLEMS)) {
    const relative = path.relative(REPO, file);
    const source = await readFile(file, "utf8");
    const report = validateProblemYaml(source, relative);
    if (!report.problem) {
      // Loud and early. A half-published catalogue is worse than a refusal,
      // because nobody notices the one problem that did not land.
      throw new Error(
        `${relative} does not validate: ` +
        report.errors.map((e) => `${e.rule} at line ${e.line}`).join(", "));
    }
    await publishImport(report.problem, source, { publish: true });
    problems += 1;
    log(`  problem  ${relative}`);
  }

  // Before the questions, because a question names its interviewers and the
  // picker filters on them. One import for the directory, so a file it no
  // longer holds is retired.
  const interviewers = await importInterviewers(await interviewerFiles());
  log(`  voice    ${interviewers} interviewers from voice-interviewers/`);

  let voiceQuestions = 0;
  for (const file of await publishableYamlFiles(VOICE)) {
    const relative = path.relative(REPO, file);
    await importVoiceQuestion(await readFile(file, "utf8"), relative);
    voiceQuestions += 1;
    log(`  voice    ${relative}`);
  }

  return { problems, interviewers, voiceQuestions };
}

if (import.meta.filename === process.argv[1]) {
  const report = await importAllContent();
  console.log(
    `\npublished ${report.problems} problems, ${report.interviewers} interviewers and ` +
    `${report.voiceQuestions} voice questions.`);
  await closeDb();
}
