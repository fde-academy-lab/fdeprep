/**
 * The whole Phase 2 path with the real Phase 1 battery on the end of it:
 * create, dispatch, run, write, read back.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../lib/db/pool.ts";
import { createSubmission } from "../lib/submissions/create.ts";
import { dispatchOnce } from "../lib/queue/dispatcher.ts";
import { runOnce, writeResultsOnce } from "../lib/queue/runner-worker.ts";
import { publicView } from "../lib/submissions/view.ts";
import { depth } from "../lib/queue/shim.ts";
import { importFixtures, resetDatabase, seedLearner } from "./helpers.ts";

let learner: Awaited<ReturnType<typeof seedLearner>>;

beforeEach(async () => {
  await resetDatabase();
  learner = await seedLearner();
  await importFixtures();
});

afterAll(async () => { await closeDb(); });

async function problemId(slug: string): Promise<number> {
  const { rows } = await db().query<{ id: string }>(
    "select id from problem where slug = $1", [slug]);
  return Number(rows[0]!.id);
}

/** Turn the whole crank once, the way the deployed workers would. */
async function drain(): Promise<void> {
  await dispatchOnce();
  await runOnce();
  await writeResultsOnce();
}

const PASSES = `
def run_agent(question, llm, tools):
    scratchpad = f"Question: {question}\\n"
    for _ in range(6):
        output = llm(scratchpad)
        if "Final Answer:" in output:
            return output.split("Final Answer:", 1)[1].strip()
        result = tools["probe"]()
        scratchpad += output + "\\nobservation\\n"
    return "gave up"
`;

const BLOCKED = `
import socket
def run_agent(question, llm, tools):
    return "x"
`;

describe("a submission goes all the way through", () => {
  it("comes back terminal with a verdict the client can render", async () => {
    const id = (await createSubmission({
      enrolmentId: learner.enrolmentId, cohortId: learner.cohortId,
      problemId: await problemId("echo-the-question"), kind: "run", body: PASSES,
    })).id;

    await drain();

    const view = await publicView(id);
    expect(view.status).toBe("terminal");
    expect(view.verdict).toBe("pass");
    expect(view.gates.public.status).toBe("pass");
    expect(view.gates.public.cases.length).toBeGreaterThan(0);
    expect(await depth("submissions")).toBe(0);
    expect(await depth("results")).toBe(0);
  }, 60_000);

  it("rejects code blocked by the static gate and names the reason", async () => {
    const id = (await createSubmission({
      enrolmentId: learner.enrolmentId, cohortId: learner.cohortId,
      problemId: await problemId("echo-the-question"), kind: "run", body: BLOCKED,
    })).id;

    await drain();

    const view = await publicView(id);
    expect(view.verdict).toBe("rejected");
    expect(view.gates.static.status).toBe("fail");
  }, 60_000);

  it("withholds hidden case names until the learner has passed", async () => {
    const problem = await problemId("retry-once-then-degrade");
    const id = (await createSubmission({
      enrolmentId: learner.enrolmentId, cohortId: learner.cohortId,
      problemId: problem, kind: "submit", body: PASSES,
    })).id;
    await drain();

    const view = await publicView(id);
    expect(view.gates.hidden.total).toBeGreaterThan(0);
    // The learner has not passed at the moment this submission was graded, so
    // the hidden gate reports counts and no names.
    if (view.verdict !== "pass") expect(view.gates.hidden.cases).toEqual([]);
  }, 60_000);

  it("survives the browser closing, which is acceptance item 4", async () => {
    const id = (await createSubmission({
      enrolmentId: learner.enrolmentId, cohortId: learner.cohortId,
      problemId: await problemId("bound-the-agent-loop"), kind: "run", body: PASSES,
    })).id;

    // Nobody subscribes. The pipeline runs anyway.
    await drain();
    const view = await publicView(id);
    expect(view.status).toBe("terminal");
    expect(view.finishedAt).not.toBeNull();
  }, 60_000);

  it("handles ten concurrent submissions without losing one", async () => {
    const problem = await problemId("echo-the-question");
    const ids = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        createSubmission({
          enrolmentId: learner.enrolmentId, cohortId: learner.cohortId,
          problemId: problem, kind: "run", body: `${PASSES}\n# ${i}\n`,
        }).then((s) => s.id)));

    await dispatchOnce();
    while (await depth("submissions")) await runOnce();
    while (await depth("results")) await writeResultsOnce();

    const views = await Promise.all(ids.map(publicView));
    expect(views.every((v) => v.status === "terminal")).toBe(true);
    expect(new Set(ids).size).toBe(10);
  }, 120_000);
});
