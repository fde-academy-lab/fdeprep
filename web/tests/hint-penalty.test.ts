/**
 * docs/03 section 5, the scoring formula: hint_pen is 5 points per hint
 * revealed, capped at 25, and comes off every score.
 *
 * Found on 8 October 2026 by reading. The judge worker sent the attempt's
 * revealed hints with every judgement, so prompt and design scores carried the
 * penalty. The runner worker never sent the count and the runner defaulted it
 * to 0, so no code score ever did, whatever the learner revealed.
 *
 * Written before the fix. What these pin down: the runner worker reads the
 * count from the attempt row on the trusted side, never from the browser,
 * whose request carries none; and a submit after two hints scores exactly 10
 * points below the same code submitted before them, through the real runner.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../lib/db/pool.ts";
import { revealHint } from "../lib/attempts/actions.ts";
import { createSubmission } from "../lib/submissions/create.ts";
import { dispatchOnce } from "../lib/queue/dispatcher.ts";
import { runOnce, writeResultsOnce } from "../lib/queue/runner-worker.ts";
import { publicView } from "../lib/submissions/view.ts";
import { publishImport } from "../lib/problems/import.ts";
import { validateProblemYaml } from "../lib/problems/validate.ts";
import { resetDatabase, seedLearner } from "./helpers.ts";

const PROBLEMS = path.join(import.meta.dirname, "..", "..", "problems");
// Medium: the hidden count is shown and hints open after one failed run. Its
// naive solution passes both public cases and fails a hidden one.
const WORKED = "harness/recover-from-soft-tool-errors";

let learner: Awaited<ReturnType<typeof seedLearner>>;
let problemId: number;
let naive: string;

beforeEach(async () => {
  await resetDatabase();
  learner = await seedLearner();
  const source = await readFile(path.join(PROBLEMS, `${WORKED}.yaml`), "utf8");
  const report = validateProblemYaml(source, WORKED);
  if (!report.problem) throw new Error(JSON.stringify(report.errors));
  problemId = (await publishImport(report.problem, source, { publish: true })).problemId;
  naive = await readFile(path.join(PROBLEMS, WORKED, "naive_solution.py"), "utf8");
});

afterAll(async () => {
  await closeDb();
});

const context = () => ({ enrolmentId: learner.enrolmentId, cohortId: learner.cohortId, problemId });

async function submit(body: string): Promise<number> {
  const created = await createSubmission({ ...context(), kind: "submit", body });
  await dispatchOnce();
  await runOnce();
  await writeResultsOnce();
  return created.id;
}

describe("the runner worker sends the attempt's revealed hints", () => {
  it("reads the count from the attempt row into the runner's event", async () => {
    // One failed submit opens the hints on this tier. Its result is scripted,
    // since only the event the worker builds matters here.
    const failed = await createSubmission({ ...context(), kind: "submit", body: naive });
    await db().query(
      "update submission set status = 'terminal', verdict = 'fail', finished_at = now() where id = $1",
      [failed.id]);
    await revealHint(context());
    await revealHint(context());

    await createSubmission({ ...context(), kind: "submit", body: `${naive}\n` });
    await dispatchOnce();
    const events: Array<Record<string, unknown>> = [];
    await runOnce({
      functionName: "fdeprep-runner",
      lambda: async (_fn, event) => {
        events.push(event);
        return { verdict: "error", message: "recorded", consumes_allowance: false };
      },
    });

    // The failed submit already has its verdict, so the dispatcher sends only this one.
    expect(events).toHaveLength(1);
    expect(events[0]!["hints_revealed"]).toBe(2);
  });
});

describe("a code score carries the hint penalty, through the real runner", () => {
  it("scores a submit after two hints exactly 10 points below the same code before them", async () => {
    const before = await publicView(await submit(naive));
    expect(before.verdict).toBe("fail");

    // docs/03 section 5 with no hints: 30 for the public ratio, 70 for the
    // hidden one, less 10 when the calls ran over budget.
    const hidden = before.gates.hidden;
    const overBudget = before.budget?.["within_budget"] === false ? 10 : 0;
    const expected = Math.round((30 + 70 * (hidden.passed / hidden.total) - overBudget) * 100) / 100;
    expect(before.score).toBe(expected);

    await revealHint(context());
    await revealHint(context());
    const after = await publicView(await submit(`${naive}\n`));

    expect(after.verdict).toBe("fail");
    expect(after.gates.hidden).toEqual(hidden);
    expect(after.score).toBe(before.score! - 2 * 5);
  }, 120_000);
});
