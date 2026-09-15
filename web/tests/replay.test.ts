/**
 * Phase 5 acceptance 5: the replay viewer flags a repeated identical tool call
 * in the seeded failing trace.
 *
 * The trace comes from a real submission through the real battery, not from a
 * hand-written JSON blob, because the flag it has to find is produced by the
 * runner's post-processing and a hand-written trace would only prove that the
 * viewer can read what the test wrote.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../lib/db/pool.ts";
import { createSubmission } from "../lib/submissions/create.ts";
import { resolvePolicy } from "../lib/policy/index.ts";
import { dispatchOnce } from "../lib/queue/dispatcher.ts";
import { runOnce, writeResultsOnce } from "../lib/queue/runner-worker.ts";
import { replayFor } from "../lib/trace/replay.ts";
import { loadTrace } from "../lib/trace/store.ts";
import { importFixtures, resetDatabase, seedLearner } from "./helpers.ts";

let learner: Awaited<ReturnType<typeof seedLearner>>;

beforeEach(async () => {
  await resetDatabase();
  await importFixtures();
  learner = await seedLearner({ persona: "navigator" });
});

afterAll(async () => {
  await closeDb();
});

/**
 * A loop that calls the same tool with the same arguments twice in a row and
 * never branches on what comes back. This is the bug the flag exists to name.
 * It returns an empty string so the battery fails it, which leaves the attempt
 * open and the fixture author's annotations still withheld.
 */
const REPEATS_AND_FAILS = `
def run_agent(question, llm, tools):
    scratchpad = "Question: " + question + "\\n"
    probe = tools["probe"]
    for _ in range(3):
        llm(scratchpad)
        probe(id=1)
        probe(id=1)
    return ""
`.trim();

async function submit(slug: string, body: string) {
  const { rows } = await db().query<{ id: string }>(
    "select id from problem where slug = $1", [slug]);
  const problemId = Number(rows[0]!.id);

  // Some tiers want a learner-written test before Submit enables. Which ones is
  // the policy module's business, so this asks rather than naming a tier.
  const policy = await resolvePolicy({ enrolmentId: learner.enrolmentId, problemId });
  if (policy.learnerTests.required) await writeLearnerTest(problemId);

  const submission = await createSubmission({
    enrolmentId: learner.enrolmentId, cohortId: learner.cohortId,
    problemId, kind: "submit", body,
  });
  await dispatchOnce();
  await runOnce();
  await writeResultsOnce();
  return submission;
}

/**
 * The naive loop: it pastes raw tool output into the prompt, so it clears the
 * ordinary cases and walks into the injection fixture. That is what makes the
 * adversarial case run, which is what gives its annotation a step to attach to.
 */
const PASTES_TOOL_OUTPUT = `
def run_agent(question, llm, tools):
    scratchpad = "Question: " + question + "\\n"
    probe = tools["probe"]
    for _ in range(4):
        output = llm(scratchpad)
        if "Final Answer:" in output:
            return output.split("Final Answer:", 1)[1].strip()
        result = probe(id=1)
        scratchpad += "Observation: " + str(result) + "\\n"
    return "I could not complete this request."
`.trim();

async function writeLearnerTest(problemId: number): Promise<void> {
  const { rows } = await db().query<{ id: string }>(
    `insert into attempt (enrolment_id, problem_id, cohort_id) values ($1, $2, $3)
     on conflict (enrolment_id, problem_id) do update set problem_id = excluded.problem_id
     returning id`,
    [learner.enrolmentId, problemId, learner.cohortId]);
  await db().query(
    "insert into learner_test (attempt_id, body) values ($1, $2)",
    [Number(rows[0]!.id), "def test_returns_something():\n    assert run_agent('q', llm, tools)"]);
}

describe("acceptance 5: the repeated identical tool call is flagged", () => {
  it("finds the flag on a loop that calls the same tool twice in a row", async () => {
    const submission = await submit("echo-the-question", REPEATS_AND_FAILS);
    const replay = await replayFor(submission.id);

    expect(replay.available).toBe(true);
    expect(replay.flags).toContain("repeated_identical_tool_call");
  });

  it("counts the model calls and tool calls the header shows", async () => {
    const submission = await submit("echo-the-question", REPEATS_AND_FAILS);
    const replay = await replayFor(submission.id);

    expect(replay.llmCalls).toBeGreaterThan(0);
    expect(replay.toolCalls).toBeGreaterThan(0);
    expect(replay.steps).toHaveLength(replay.llmCalls + replay.toolCalls +
      replay.steps.filter((s) => s.type !== "llm_call" && s.type !== "tool_call").length);
  });

  it("numbers the steps so the viewer can walk them", async () => {
    const submission = await submit("echo-the-question", REPEATS_AND_FAILS);
    const replay = await replayFor(submission.id);
    expect(replay.steps.map((s) => s.index)).toEqual(replay.steps.map((_, i) => i));
  });

  it("gives every step a one-line summary", async () => {
    const submission = await submit("echo-the-question", REPEATS_AND_FAILS);
    for (const step of (await replayFor(submission.id)).steps) {
      expect(step.summary.length).toBeGreaterThan(0);
    }
  });
});

describe("the trace is stored out of the result contract", () => {
  it("writes a trace row the viewer reads", async () => {
    const submission = await submit("echo-the-question", REPEATS_AND_FAILS);
    const stored = await loadTrace(submission.id);
    expect(stored).not.toBeNull();
    expect(stored!.stepCount).toBeGreaterThan(0);
  });

  it("leaves no trace inside submission.result", async () => {
    // docs/03 section 5: the front end renders from the result contract, and
    // that contract carries a reference rather than a trace.
    const submission = await submit("echo-the-question", REPEATS_AND_FAILS);
    const { rows } = await db().query<{ result: Record<string, unknown> }>(
      "select result from submission where id = $1", [submission.id]);
    expect(Object.keys(rows[0]!.result)).not.toContain("trace");
  });

  it("returns an empty replay for a submission that has no trace", async () => {
    const replay = await replayFor(999999);
    expect(replay.available).toBe(false);
    expect(replay.steps).toEqual([]);
  });
});

describe("fixture annotations wait for the attempt to close", () => {
  it("withholds the fixture author's note while the attempt is open", async () => {
    const submission = await submit("survive-the-hostile-tool", PASTES_TOOL_OUTPUT);
    const replay = await replayFor(submission.id);

    expect(replay.attemptClosed).toBe(false);
    expect(replay.steps.every((s) => s.fixtureAnnotation === null)).toBe(true);
  });

  it("still shows the trace itself on a failed Extreme submission", async () => {
    // docs/01 S7: the trace is available because the learning happens there,
    // even though the attempt is spent.
    const submission = await submit("survive-the-hostile-tool", PASTES_TOOL_OUTPUT);
    const replay = await replayFor(submission.id);
    expect(replay.available).toBe(true);
    expect(replay.steps.length).toBeGreaterThan(0);
  });

  it("opens the notes once the learner gives up", async () => {
    const submission = await submit("survive-the-hostile-tool", PASTES_TOOL_OUTPUT);
    await db().query(
      `update attempt set gave_up_at = now()
        where id = (select attempt_id from submission where id = $1)`, [submission.id]);

    const replay = await replayFor(submission.id);
    expect(replay.attemptClosed).toBe(true);
    const annotated = replay.steps.filter((s) => s.fixtureAnnotation !== null);
    expect(annotated.length).toBeGreaterThan(0);
  });

  it("opens them on a pass too", async () => {
    const submission = await submit("survive-the-hostile-tool", PASTES_TOOL_OUTPUT);
    await db().query(
      `update attempt set solved_at = now()
        where id = (select attempt_id from submission where id = $1)`, [submission.id]);
    expect((await replayFor(submission.id)).attemptClosed).toBe(true);
  });

  it("shows the runner's own annotation without waiting", async () => {
    // The automatic annotations are the teaching mechanism from docs/03
    // section 6, so they are never gated.
    const submission = await submit("echo-the-question", REPEATS_AND_FAILS);
    const replay = await replayFor(submission.id);
    expect(replay.attemptClosed).toBe(false);
    expect(replay.flags.length).toBeGreaterThan(0);
  });
});
