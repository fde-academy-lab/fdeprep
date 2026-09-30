/**
 * docs/01 S4: the steps checklist turns green from the run's own result.
 *
 * Written before the view carried steps. The checklist used to be ticked by
 * hand in local storage, which recorded what the learner believed rather than
 * what their code did. What these pin down: a run of the reference turns every
 * step green through the whole path, a run of the starter code leaves one red,
 * and a reload shows the last run's steps rather than an empty list.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "../lib/db/pool.ts";
import { publishImport } from "../lib/problems/import.ts";
import { validateProblemYaml } from "../lib/problems/validate.ts";
import { attemptHistory } from "../lib/problems/workspace.ts";
import { createSubmission } from "../lib/submissions/create.ts";
import { dispatchOnce } from "../lib/queue/dispatcher.ts";
import { runOnce, writeResultsOnce } from "../lib/queue/runner-worker.ts";
import { publicView } from "../lib/submissions/view.ts";
import { resetDatabase, seedLearner } from "./helpers.ts";

const PROBLEMS = path.join(import.meta.dirname, "..", "..", "problems");
const EASY = "tool-creation/dispatch-only-registered-actions";

let learner: Awaited<ReturnType<typeof seedLearner>>;
let problemId: number;
let source: string;

beforeEach(async () => {
  await resetDatabase();
  learner = await seedLearner();
  source = await readFile(path.join(PROBLEMS, `${EASY}.yaml`), "utf8");
  const report = validateProblemYaml(source, EASY);
  if (!report.problem) throw new Error(JSON.stringify(report.errors));
  problemId = (await publishImport(report.problem, source, { publish: true })).problemId;
});

afterAll(async () => { await closeDb(); });

async function run(body: string) {
  const { id } = await createSubmission({
    enrolmentId: learner.enrolmentId, cohortId: learner.cohortId, problemId, kind: "run", body,
  });
  await dispatchOnce();
  await runOnce();
  await writeResultsOnce();
  return publicView(id);
}

describe("the steps checklist", () => {
  it("turns no step red on a run of the reference", async () => {
    const reference = await readFile(path.join(PROBLEMS, EASY, "reference_solution.py"), "utf8");
    const view = await run(reference);
    expect(view.status).toBe("terminal");
    expect(view.steps.map((s) => s.id)).toEqual(["s1", "s2", "s3", "s4"]);
    expect(view.steps.some((s) => s.status === "fail")).toBe(false);
    expect(view.steps.some((s) => s.status === "pass")).toBe(true);
  });

  it("never turns a step green on a run of the starter code", async () => {
    // A check the stub already satisfies reads unchecked: the public cases
    // cannot tell the learner's work from no work.
    const stub = validateProblemYaml(source, EASY).problem!.stub_code!;
    const view = await run(stub);
    expect(view.steps.some((s) => s.status === "fail")).toBe(true);
    expect(view.steps.some((s) => s.status === "pass")).toBe(false);
  });

  it("comes back after a reload as the last run left it", async () => {
    const reference = await readFile(path.join(PROBLEMS, EASY, "reference_solution.py"), "utf8");
    const view = await run(reference);
    const history = await attemptHistory(learner.enrolmentId, problemId);
    expect(history.steps).toEqual(view.steps);
  });

  it("is empty before the first run", async () => {
    expect((await attemptHistory(learner.enrolmentId, problemId)).steps).toEqual([]);
  });
});
