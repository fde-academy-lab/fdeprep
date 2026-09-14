/**
 * docs/03 section 9.4. The learner writes one run_agent for both modes, and
 * the credential never reaches their process.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../lib/db/pool.ts";
import { runLive, scriptedModel, MAX_STEPS } from "../lib/live/worker.ts";
import { importFixtures, resetDatabase, seedLearner } from "./helpers.ts";

let learner: Awaited<ReturnType<typeof seedLearner>>;

beforeEach(async () => {
  await resetDatabase();
  learner = await seedLearner();
  await importFixtures();
});
afterAll(async () => { await closeDb(); });

/** The same shape a learner writes against the mock. Nothing is mode-aware. */
const SOLUTION = `
def run_agent(question, llm, tools):
    scratchpad = "Question: " + question
    for _ in range(4):
        output = llm(scratchpad)
        if "Final Answer:" in output:
            return output.split("Final Answer:", 1)[1].strip()
        result = tools["lookup"](id=7)
        scratchpad += "\\nobservation: " + str(result)
    return "gave up"
`;

async function attempt() {
  const { rows } = await db().query<{ id: string; version_id: string }>(
    `select p.id, v.id as version_id from problem p
       join problem_version v on v.problem_id = p.id and v.version = p.current_version
      where p.difficulty = 'medium' limit 1`);
  const problem = rows[0]!;
  const created = await db().query<{ id: string }>(
    `insert into attempt (enrolment_id, problem_id, cohort_id) values ($1,$2,$3) returning id`,
    [learner.enrolmentId, problem.id, learner.cohortId]);
  return { attemptId: Number(created.rows[0]!.id), versionId: Number(problem.version_id) };
}

describe("the step protocol", () => {
  it("drives the same run_agent to a final answer through the worker", async () => {
    const { attemptId, versionId } = await attempt();
    const outcome = await runLive({
      attemptId, problemVersionId: versionId, modelId: "test-model",
      solution: SOLUTION, question: "where is order 7", tools: ["lookup"],
      budget: { max_llm_calls: 4, max_tool_calls: 4 },
      model: scriptedModel(["Action: lookup(id=7)", "Final Answer: it is in transit"]),
      toolRunner: { async call() { return { status: 200, state: "in_transit" }; } },
    });

    expect(outcome.status).toBe("finished");
    expect(String(outcome.value)).toContain("in transit");
  }, 60_000);

  it("records the authoritative events on the worker side, in order", async () => {
    const { attemptId, versionId } = await attempt();
    const outcome = await runLive({
      attemptId, problemVersionId: versionId, modelId: "test-model",
      solution: SOLUTION, question: "q", tools: ["lookup"],
      budget: { max_llm_calls: 4, max_tool_calls: 4 },
      model: scriptedModel(["Action: lookup(id=1)", "Final Answer: done"]),
      toolRunner: { async call() { return { status: 200 }; } },
    });

    const { rows } = await db().query<{ seq: number; kind: string }>(
      `select seq, kind from live_run_event where live_run_id = $1 order by seq`,
      [outcome.liveRunId]);
    expect(rows.map((r) => r.kind)).toEqual([
      "llm_call", "llm_response", "tool_call", "observation", "llm_call", "llm_response", "final",
    ]);
    // Written by the worker, not by learner code, which is what makes the
    // trace authoritative.
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  }, 60_000);

  it("never hands learner code a model identifier or a credential", async () => {
    const { attemptId, versionId } = await attempt();
    // This solution tries to find anything privileged in its own process.
    const snooping = `
import json


def run_agent(question, llm, tools):
    found = [k for k in dir() if "model" in k.lower() or "key" in k.lower()]
    globals_seen = [k for k in globals() if "model" in k.lower() or "key" in k.lower()]
    return "Final Answer: " + json.dumps(found + globals_seen)
`;
    const outcome = await runLive({
      attemptId, problemVersionId: versionId, modelId: "super-secret-model-id",
      solution: snooping, question: "q", tools: [],
      budget: { max_llm_calls: 2, max_tool_calls: 2 },
      model: scriptedModel(["unused"]),
    });

    expect(outcome.status).toBe("finished");
    expect(String(outcome.value)).not.toContain("super-secret-model-id");
    // The list it built is empty: nothing model- or key-shaped is reachable
    // from inside the sandbox's own scope.
    expect(String(outcome.value)).toContain("[]");
  }, 60_000);

  it("stops a loop that never finishes, rather than running forever", async () => {
    const { attemptId, versionId } = await attempt();
    const forever = `
def run_agent(question, llm, tools):
    while True:
        llm("again")
`;
    const outcome = await runLive({
      attemptId, problemVersionId: versionId, modelId: "test-model",
      solution: forever, question: "q", tools: [],
      budget: { max_llm_calls: 1000, max_tool_calls: 1000 },
      model: scriptedModel(["keep going"]),
    });

    expect(outcome.status).toBe("budget_exhausted");
    const { rows } = await db().query<{ status: string; steps_used: number }>(
      `select status, steps_used from live_run where id = $1`, [outcome.liveRunId]);
    expect(rows[0]!.status).toBe("budget_exhausted");
    // Two events per step (call and response) plus the terminal marker.
    expect(outcome.steps).toBeLessThanOrEqual(MAX_STEPS * 2 + 1);
  }, 120_000);

  it("refuses a tool the worker does not offer, without calling anything", async () => {
    const { attemptId, versionId } = await attempt();
    const outcome = await runLive({
      attemptId, problemVersionId: versionId, modelId: "test-model",
      solution: SOLUTION, question: "q", tools: ["lookup"],
      budget: { max_llm_calls: 4, max_tool_calls: 4 },
      model: scriptedModel(["Action: lookup(id=1)", "Final Answer: done"]),
      // No toolRunner at all.
    });
    expect(outcome.status).toBe("finished");
    const { rows } = await db().query<{ payload: Record<string, unknown> }>(
      `select payload from live_run_event where live_run_id = $1 and kind = 'observation'`,
      [outcome.liveRunId]);
    expect(JSON.stringify(rows[0]!.payload)).toContain("no tool named lookup");
  }, 60_000);
});
