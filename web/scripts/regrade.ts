/**
 * Grade earlier submissions again under the current judge prompt. S15.3.
 *
 * Run it after a new judge prompt ships: a new file in judge/prompts/, named
 * by RUBRIC_PROMPT or DEFENCE_PROMPT and deployed with the judge. It appends a
 * new evaluation to each submission an earlier prompt graded. It never edits
 * or deletes an evaluation, never moves a verdict and never spends a learner's
 * allowance. docs/10 section 10 has the rules, and docs/05's runbook the drill.
 *
 *   npm run regrade -- --dry-run             list what would be regraded, call nothing
 *   npm run regrade                          regrade the oldest 25
 *   npm run regrade -- --limit 200           a bigger batch
 *   npm run regrade -- --from rubric.v1.md   only what that prompt graded
 *
 * Each regrade is one model call, made the way the worker makes them:
 * JUDGE_FUNCTION, then JUDGE_ENDPOINT, then a local subprocess.
 */
import { closeDb } from "../lib/db/pool.ts";
import {
  currentJudgePrompts, runRegrade, type CurrentPrompts, type RegradeReport,
} from "../lib/eval/regrade.ts";
import { rejudge } from "../lib/queue/judge-worker.ts";

const DEFAULT_LIMIT = 25;

const USAGE = `npm run regrade -- [--dry-run] [--limit N] [--from PROMPT]

  --dry-run      List the submissions a run would regrade. No judge call, no write.
  --limit N      Regrade at most N, oldest first. Default ${DEFAULT_LIMIT}.
  --from PROMPT  Regrade only what PROMPT graded, for example rubric.v1.md,
                 in place of everything the current prompt did not grade.`;

export interface RegradeArgs {
  dryRun: boolean;
  limit: number;
  from?: string;
  help: boolean;
}

/** The arguments, or a message saying what to type instead. */
export function parseArgs(argv: string[]): RegradeArgs | string {
  const args: RegradeArgs = { dryRun: false, limit: DEFAULT_LIMIT, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--dry-run") args.dryRun = true;
    else if (flag === "--help" || flag === "-h") args.help = true;
    else if (flag === "--limit") {
      const value = Number(argv[(i += 1)]);
      if (!Number.isInteger(value) || value < 1) {
        return "--limit takes a whole number of 1 or more, for example --limit 50.";
      }
      args.limit = value;
    } else if (flag === "--from") {
      const value = argv[(i += 1)] ?? "";
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/.test(value)) {
        return "--from takes a file name from judge/prompts/, for example --from rubric.v1.md.";
      }
      args.from = value;
    } else {
      return `${flag} is not an option. Run npm run regrade -- --help to see the options.`;
    }
  }
  return args;
}

/** What the run did, one line each, for the operator reading the terminal. */
export function describe(
  report: RegradeReport, args: RegradeArgs, current: CurrentPrompts,
): string[] {
  const lines = [
    `Current judge prompts: ${current.rubric} for design and prompt answers, ` +
      `${current.defence} for defences.`,
    args.from
      ? `Selecting submissions whose newest evaluation ${args.from} graded, oldest first, ` +
        `up to ${args.limit}.`
      : "Selecting submissions whose newest evaluation a prompt other than the current one " +
        `graded, oldest first, up to ${args.limit}.`,
  ];

  if (!report.candidates.length) {
    lines.push("Nothing to regrade. Every submission that selection covers is graded already.");
    return lines;
  }

  if (args.dryRun) {
    lines.push(`${report.candidates.length} to regrade:`);
    for (const c of report.candidates) {
      lines.push(`  submission ${c.submissionId}  ${c.login}  ${c.slug}  ` +
        `graded with ${c.judgePrompt ?? "no recorded prompt"}, ${c.band ?? "no band"}, ` +
        `${c.gradedAt.slice(0, 10)}`);
    }
    lines.push("Dry run: nothing was sent to the judge and nothing was written.");
    return lines;
  }

  let regraded = 0;
  for (const { candidate, outcome } of report.results) {
    if (outcome.status === "written") {
      regraded += 1;
      lines.push(`  regraded submission ${candidate.submissionId}: ` +
        `${candidate.judgePrompt ?? "no recorded prompt"} ${candidate.band ?? "no band"}, ` +
        `now ${outcome.evaluation.judgePrompt} ${outcome.evaluation.band ?? "no band"} ` +
        `(evaluation ${outcome.evaluationId})`);
    } else {
      lines.push(`  left submission ${candidate.submissionId} as it was: ${outcome.reason}`);
    }
  }
  lines.push(`Regraded ${regraded} of ${report.candidates.length}. No verdict moved and no ` +
    "allowance was spent.");
  if (report.stopped) {
    lines.push(`Stopped early: ${report.stopped}`);
  } else if (report.candidates.length === args.limit) {
    lines.push("The batch was full. Run it again for the next one.");
  }
  return lines;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args === "string") {
    console.error(args);
    process.exitCode = 1;
    return;
  }
  if (args.help) {
    console.log(USAGE);
    return;
  }

  const current = currentJudgePrompts();
  const report = await runRegrade({
    current, from: args.from, limit: args.limit, dryRun: args.dryRun,
    rejudge: (submissionId) => rejudge(submissionId),
  });
  for (const line of describe(report, args, current)) console.log(line);
  if (report.stopped) process.exitCode = 1;
}

if (import.meta.filename === process.argv[1]) {
  try {
    await main();
  } finally {
    await closeDb();
  }
}
