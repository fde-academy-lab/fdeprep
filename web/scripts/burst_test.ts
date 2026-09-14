/**
 * Phase 3 acceptance 7: two hundred concurrent submits are all accepted or all
 * correctly rejected by the cap, with no counter drift.
 *
 * Drift is the thing being hunted. Two transactions reading the same counter
 * and both writing count+1 lose a decrement, and the learner gets a free
 * attempt; two transactions inserting a first window row race the unique
 * index. Either way the counter and the accepted count stop agreeing, and the
 * only honest check is that they agree exactly.
 *
 *   npm run burst -- --submits 200 --difficulty medium
 *
 * Run against preview, never production: it writes real submissions.
 */
import { closeDb, db } from "../lib/db/pool.ts";
import {
  createSubmission, DuplicateSubmissionError, GateRefused, RateLimitError,
} from "../lib/submissions/create.ts";
import { saveLearnerTest } from "../lib/attempts/actions.ts";
import { resolvePolicy } from "../lib/policy/index.ts";
import { allowanceFor, type Difficulty } from "../lib/policy/index.ts";

interface Options {
  submits: number;
  difficulty: Difficulty;
  slug: string | null;
}

function parse(argv: string[]): Options {
  const get = (flag: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  return {
    submits: Number(get("--submits") ?? 200),
    difficulty: (get("--difficulty") ?? "medium") as Difficulty,
    slug: get("--slug") ?? null,
  };
}

export interface BurstReport {
  fired: number;
  accepted: number;
  rejectedByCap: number;
  rejectedAsDuplicate: number;
  refusedByGate: number;
  otherErrors: string[];
  counter: number;
  submissionRows: number;
  outboxRows: number;
  max: number | null;
  drift: number;
  ok: boolean;
}

export async function burst(options: Options): Promise<BurstReport> {
  const learner = await resolveLearner();
  const problem = await resolveProblem(options);

  // Satisfy any prerequisite the tier imposes, so the burst exercises the cap
  // rather than stopping at a gate. On Extreme that means a learner test
  // exists before the 200 submits are fired.
  const policy = await resolvePolicy({
    enrolmentId: learner.enrolmentId, problemId: problem.id });
  if (policy.learnerTests.required && !policy.learnerTests.withAssertion) {
    await saveLearnerTest({
      enrolmentId: learner.enrolmentId, cohortId: learner.cohortId, problemId: problem.id,
      body: "def test_burst():\n    assert run_agent is not None\n",
    });
    console.log("seeded a learner test, which this tier requires before Submit opens");
  }

  const before = await allowanceFor({
    enrolmentId: learner.enrolmentId, problemId: problem.id,
    difficulty: options.difficulty, scope: "submit_daily",
  });

  // All at once. Promise.allSettled rather than all, because the point is to
  // count refusals, not to stop at the first one.
  const outcomes = await Promise.allSettled(
    Array.from({ length: options.submits }, (_, i) =>
      createSubmission({
        enrolmentId: learner.enrolmentId,
        cohortId: learner.cohortId,
        problemId: problem.id,
        kind: "submit",
        // Distinct bodies, so a duplicate rejection cannot be confused with a
        // cap rejection on a tier that dedupes.
        body: `def run_agent(q, llm, tools):\n    return "burst ${i}"\n`,
      })));

  let accepted = 0;
  let rejectedByCap = 0;
  let rejectedAsDuplicate = 0;
  let refusedByGate = 0;
  const otherErrors: string[] = [];

  for (const outcome of outcomes) {
    if (outcome.status === "fulfilled") { accepted += 1; continue; }
    const error = outcome.reason as Error;
    if (error instanceof RateLimitError) rejectedByCap += 1;
    else if (error instanceof DuplicateSubmissionError) rejectedAsDuplicate += 1;
    // A gate refusal is a correct refusal, not drift. Counting it as an
    // unexpected error made a working tier look broken.
    else if (error instanceof GateRefused) refusedByGate += 1;
    else otherErrors.push(error.message);
  }

  const after = await allowanceFor({
    enrolmentId: learner.enrolmentId, problemId: problem.id,
    difficulty: options.difficulty, scope: "submit_daily",
  });

  const rows = await db().query<{ submissions: string; outbox: string }>(
    `select (select count(*) from submission s join attempt a on a.id = s.attempt_id
              where a.enrolment_id = $1 and a.problem_id = $2 and s.kind = 'submit')
                as submissions,
            (select count(*) from outbox o join submission s on s.id = o.submission_id
               join attempt a on a.id = s.attempt_id
              where a.enrolment_id = $1 and a.problem_id = $2 and s.kind = 'submit')
                as outbox`,
    [learner.enrolmentId, problem.id]);

  const counter = after.used;
  const submissionRows = Number(rows.rows[0]!.submissions);
  const outboxRows = Number(rows.rows[0]!.outbox);

  // Drift: the counter must equal what was there before plus what was
  // accepted, and every accepted submission must have exactly one row and one
  // outbox message.
  const drift = counter - (before.used + accepted);
  const ok =
    drift === 0 &&
    submissionRows === accepted &&
    outboxRows === accepted &&
    otherErrors.length === 0 &&
    (after.max === null || counter <= after.max);

  return {
    fired: options.submits, accepted, rejectedByCap, rejectedAsDuplicate, refusedByGate,
    otherErrors, counter, submissionRows, outboxRows, max: after.max, drift, ok,
  };
}

async function resolveLearner() {
  const { rows } = await db().query<{ enrolment_id: string; cohort_id: string }>(
    `select e.id as enrolment_id, e.cohort_id from enrolment e order by e.id limit 1`);
  const row = rows[0];
  if (!row) throw new Error("no enrolment exists. Seed one before running the burst test.");
  return { enrolmentId: Number(row.enrolment_id), cohortId: Number(row.cohort_id) };
}

async function resolveProblem(options: Options) {
  const { rows } = await db().query<{ id: string; slug: string }>(
    options.slug
      ? `select id, slug from problem where slug = $1`
      : `select id, slug from problem where difficulty::text = $1 order by id limit 1`,
    [options.slug ?? options.difficulty]);
  const row = rows[0];
  if (!row) {
    throw new Error(
      `no ${options.slug ?? options.difficulty} problem is imported. Import the fixtures first.`);
  }
  return { id: Number(row.id), slug: row.slug };
}

if (import.meta.filename === process.argv[1]) {
  const options = parse(process.argv.slice(2));
  const report = await burst(options);

  console.log(`fired                ${report.fired}`);
  console.log(`accepted             ${report.accepted}`);
  console.log(`rejected by cap      ${report.rejectedByCap}`);
  console.log(`rejected duplicate   ${report.rejectedAsDuplicate}`);
  console.log(`refused by gate      ${report.refusedByGate}`);
  console.log(`counter              ${report.counter}${report.max === null ? "" : ` of ${report.max}`}`);
  console.log(`submission rows      ${report.submissionRows}`);
  console.log(`outbox rows          ${report.outboxRows}`);
  console.log(`drift                ${report.drift}`);
  if (report.otherErrors.length) {
    console.log(`unexpected errors    ${report.otherErrors.length}`);
    for (const message of new Set(report.otherErrors)) console.log(`  ${message}`);
  }
  const every = report.accepted + report.rejectedByCap + report.rejectedAsDuplicate +
    report.refusedByGate + report.otherErrors.length;
  console.log(`accounted for        ${every} of ${report.fired}`);
  console.log(report.ok ? "\nNo counter drift." : "\nDRIFT DETECTED.");

  await closeDb();
  process.exit(report.ok ? 0 : 1);
}
