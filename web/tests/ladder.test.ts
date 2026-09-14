/**
 * Phase 3 acceptance, from docs/06. Every item is here and the two the brief
 * singled out are the last two blocks.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../lib/db/pool.ts";
import { resolvePolicy, allowanceFor, type Difficulty } from "../lib/policy/index.ts";
import { giveUp, revealHint, saveAttemptNote, saveLearnerTest, GateError }
  from "../lib/attempts/actions.ts";
import { createSubmission, DuplicateSubmissionError, GateRefused, RateLimitError }
  from "../lib/submissions/create.ts";
import { dispatchOnce } from "../lib/queue/dispatcher.ts";
import { receive } from "../lib/queue/shim.ts";
import { writeResult } from "../lib/queue/result-writer.ts";
import { stateForSubmission, isUpgrade } from "../lib/competency/score.ts";
import { importFixtures, resetDatabase, seedLearner } from "./helpers.ts";

let learner: Awaited<ReturnType<typeof seedLearner>>;

beforeEach(async () => {
  await resetDatabase();
  learner = await seedLearner();
  await importFixtures();
});
afterAll(async () => { await closeDb(); });

/**
 * The ladder rules these tests cover are code-problem rules: the learner-test
 * gate and the attempt note both ask for something only a code problem has.
 * Since Phase 4 the fixtures include a prompt and a design problem, so the
 * artefact type is pinned rather than left to whichever row sorts first.
 */
async function problemAt(
  difficulty: Difficulty, artefact: "code" | "prompt" | "design" = "code",
): Promise<number> {
  const { rows } = await db().query<{ id: string }>(
    `select id from problem
      where difficulty::text = $1 and artefact_type::text = $2 order by id limit 1`,
    [difficulty, artefact]);
  if (!rows[0]) throw new Error(`no ${difficulty} ${artefact} fixture imported`);
  return Number(rows[0].id);
}

function ctx(problemId: number) {
  return { enrolmentId: learner.enrolmentId, cohortId: learner.cohortId, problemId };
}

/** Drive a submission to a terminal verdict with a result we choose. */
async function settle(submissionId: number, result: Record<string, unknown>) {
  await dispatchOnce();
  const messages = await receive("submissions", 10);
  const message = messages.find((m) => Number(m.body["submission_id"]) === submissionId);
  if (!message) throw new Error(`no queue message for submission ${submissionId}`);
  return writeResult({
    submission_id: submissionId,
    lease_token: String(message.body["lease_token"]),
    fencing_token: Number(message.body["fencing_token"]),
    body_sha256: String(message.body["body_sha256"]),
    result,
  });
}

function resultWith(overrides: Record<string, unknown> = {}) {
  return {
    verdict: "fail", score: 30,
    gates: {
      static: { status: "pass" },
      public: { status: "fail", passed: 1, total: 2, cases: [] },
      hidden: { status: "skipped", passed: 0, total: 2, cases: [] },
      adversarial: { status: "skipped", passed: 0, total: 1, cases: [] },
    },
    budget: { llm_calls: 3, tool_calls: 1, wall_ms: 5, max_llm_calls: 6, within_budget: true },
    runner: { image_tag: "test", duration_ms: 5 },
    ...overrides,
  };
}

describe("acceptance 1: four difficulties render four different left panes", () => {
  it("differs in layers, visibility and hint policy, from the policy module alone", async () => {
    const seen = new Map<Difficulty, string>();
    for (const difficulty of ["easy", "medium", "hard", "extreme"] as Difficulty[]) {
      const policy = await resolvePolicy({
        enrolmentId: learner.enrolmentId, problemId: await problemAt(difficulty) });
      seen.set(difficulty, JSON.stringify({
        layers: policy.layers, visibility: policy.visibility, hints: policy.hints.label }));
    }
    expect(new Set(seen.values()).size).toBe(4);
  });

  it("puts the documented layers on each tier", async () => {
    const layersAt = async (d: Difficulty) =>
      (await resolvePolicy({ enrolmentId: learner.enrolmentId, problemId: await problemAt(d) }))
        .layers;

    const easy = await layersAt("easy");
    expect([easy.brief, easy.contract, easy.stub, easy.steps]).toEqual([true, true, true, true]);

    const medium = await layersAt("medium");
    expect([medium.contract, medium.stub, medium.steps]).toEqual([true, true, false]);

    const hard = await layersAt("hard");
    expect([hard.contract, hard.stub, hard.steps]).toEqual([true, false, false]);

    const extreme = await layersAt("extreme");
    expect([extreme.brief, extreme.contract, extreme.stub, extreme.hints])
      .toEqual([true, false, false, false]);
  });

  it("hides the hidden count and the acceptance rate as the tier rises", async () => {
    const at = async (d: Difficulty) =>
      (await resolvePolicy({ enrolmentId: learner.enrolmentId, problemId: await problemAt(d) }))
        .visibility;
    expect((await at("easy")).publicAssertions).toBe(true);
    expect((await at("medium")).publicAssertions).toBe(false);
    expect((await at("hard")).acceptanceRate).toBe(false);
    expect((await at("extreme")).hiddenCount).toBe(false);
  });
});

describe("acceptance 2: Medium hints stay locked until one failed run", () => {
  it("locks the hint and says so in the button label", async () => {
    const problemId = await problemAt("medium");
    const policy = await resolvePolicy({ enrolmentId: learner.enrolmentId, problemId });
    expect(policy.hints.allowed).toBe(false);
    expect(policy.hints.label).toBe("Unlocks after one failed run");
    await expect(revealHint(ctx(problemId))).rejects.toBeInstanceOf(GateError);
  });

  it("unlocks after a failed run and reveals one hint at a time", async () => {
    const problemId = await problemAt("medium");
    const submission = await createSubmission({ ...ctx(problemId), kind: "run", body: "x" });
    await settle(submission.id, resultWith());

    const policy = await resolvePolicy({ enrolmentId: learner.enrolmentId, problemId });
    expect(policy.hints.allowed).toBe(true);
    expect(policy.hints.label).toBe("Reveal hint 1");

    const first = await revealHint(ctx(problemId));
    expect(first.ordinal).toBe(1);
    const second = await revealHint(ctx(problemId));
    expect(second.ordinal).toBe(2);
  });

  it("logs every reveal to the attempt record and the audit log", async () => {
    const problemId = await problemAt("medium");
    const submission = await createSubmission({ ...ctx(problemId), kind: "run", body: "x" });
    await settle(submission.id, resultWith());
    await revealHint(ctx(problemId));

    const attempt = await db().query<{ hints_used: number }>(
      `select hints_used from attempt where enrolment_id = $1 and problem_id = $2`,
      [learner.enrolmentId, problemId]);
    expect(attempt.rows[0]!.hints_used).toBe(1);

    const audit = await db().query(
      `select 1 from audit_log where action = 'hint.reveal' and target = $1`,
      [`problem:${problemId}`]);
    expect(audit.rows).toHaveLength(1);
  });
});

describe("acceptance 3: Hard refuses hints until the note reaches 200 characters", () => {
  it("names the shortfall and refuses the reveal", async () => {
    const problemId = await problemAt("hard");
    for (let i = 0; i < 2; i += 1) {
      const s = await createSubmission({ ...ctx(problemId), kind: "run", body: `x${i}` });
      await settle(s.id, resultWith());
    }

    let policy = await resolvePolicy({ enrolmentId: learner.enrolmentId, problemId });
    expect(policy.hints.allowed).toBe(false);
    expect(policy.hints.label).toContain("200 character note");

    await saveAttemptNote({ ...ctx(problemId), note: "a".repeat(199) });
    policy = await resolvePolicy({ enrolmentId: learner.enrolmentId, problemId });
    expect(policy.hints.allowed).toBe(false);
    expect(policy.attemptNote.needed).toBe(1);
    await expect(revealHint(ctx(problemId))).rejects.toThrow(/200 characters/);

    await saveAttemptNote({ ...ctx(problemId), note: "a".repeat(200) });
    policy = await resolvePolicy({ enrolmentId: learner.enrolmentId, problemId });
    expect(policy.hints.allowed).toBe(true);
    expect((await revealHint(ctx(problemId))).ordinal).toBe(1);
  });

  it("still refuses at 200 characters when the failed runs are short", async () => {
    const problemId = await problemAt("hard");
    await saveAttemptNote({ ...ctx(problemId), note: "a".repeat(400) });
    const policy = await resolvePolicy({ enrolmentId: learner.enrolmentId, problemId });
    expect(policy.hints.allowed).toBe(false);
    expect(policy.hints.label).toBe("Unlocks after 2 failed runs");
  });
});

describe("acceptance 4: Extreme gates Submit on a learner test and on the daily cap", () => {
  it("refuses Submit until a test containing an assertion exists", async () => {
    const problemId = await problemAt("extreme");
    let policy = await resolvePolicy({ enrolmentId: learner.enrolmentId, problemId });
    expect(policy.submit.allowed).toBe(false);
    expect(policy.submit.label).toBe("Write a test first");
    await expect(createSubmission({ ...ctx(problemId), kind: "submit", body: "a" }))
      .rejects.toBeInstanceOf(GateRefused);

    // A test with no assertion is stored and still does not open the gate.
    const noAssert = await saveLearnerTest({ ...ctx(problemId), body: "def test_x():\n    pass" });
    expect(noAssert.withAssertion).toBe(false);
    policy = await resolvePolicy({ enrolmentId: learner.enrolmentId, problemId });
    expect(policy.submit.allowed).toBe(false);

    await saveLearnerTest({ ...ctx(problemId), body: "def test_x():\n    assert run_agent" });
    policy = await resolvePolicy({ enrolmentId: learner.enrolmentId, problemId });
    expect(policy.submit.allowed).toBe(true);
    expect(policy.confirmBeforeSubmit).toBe(true);
  });

  it("refuses a second submit inside 24 hours and names the reset time", async () => {
    const problemId = await problemAt("extreme");
    await saveLearnerTest({ ...ctx(problemId), body: "assert True" });
    await createSubmission({ ...ctx(problemId), kind: "submit", body: "first" });

    await expect(createSubmission({ ...ctx(problemId), kind: "submit", body: "second" }))
      .rejects.toThrow(/one submit per problem per day/);

    const policy = await resolvePolicy({ enrolmentId: learner.enrolmentId, problemId });
    expect(policy.submit.allowed).toBe(false);
    expect(policy.submit.reason).toMatch(/next attempt is in/);
    expect(policy.submit.resetInS).toBeGreaterThan(0);
  });
});

describe("acceptance 5: an identical Extreme resubmission is rejected before the cap moves", () => {
  it("rejects by hash and leaves the counter exactly where it was", async () => {
    const problemId = await problemAt("extreme");
    await saveLearnerTest({ ...ctx(problemId), body: "assert True" });

    const body = "def run_agent(q, llm, tools):\n    return 'same bytes'\n";
    await createSubmission({ ...ctx(problemId), kind: "submit", body });

    const before = await allowanceFor({
      enrolmentId: learner.enrolmentId, problemId, difficulty: "extreme", scope: "submit_daily" });
    expect(before.used).toBe(1);

    // Raise the cap so the only thing that can refuse the resubmission is the
    // hash. Without this the test would pass for the wrong reason.
    await db().query(
      `update rate_limit_policy set max_count = 5
        where scope = 'submit_daily' and difficulty = 'extreme'`);

    await expect(createSubmission({ ...ctx(problemId), kind: "submit", body }))
      .rejects.toBeInstanceOf(DuplicateSubmissionError);

    const after = await allowanceFor({
      enrolmentId: learner.enrolmentId, problemId, difficulty: "extreme", scope: "submit_daily" });
    expect(after.used).toBe(before.used);

    const rows = await db().query<{ count: string }>(
      `select count(*) from submission s join attempt a on a.id = s.attempt_id
        where a.problem_id = $1 and s.kind = 'submit'`, [problemId]);
    expect(Number(rows.rows[0]!.count)).toBe(1);
  });

  it("lets a changed body through, so the hash check is not just refusing everything", async () => {
    const problemId = await problemAt("extreme");
    await saveLearnerTest({ ...ctx(problemId), body: "assert True" });
    await db().query(
      `update rate_limit_policy set max_count = 5
        where scope = 'submit_daily' and difficulty = 'extreme'`);

    await createSubmission({ ...ctx(problemId), kind: "submit", body: "one" });
    const second = await createSubmission({ ...ctx(problemId), kind: "submit", body: "two" });
    expect(second.id).toBeGreaterThan(0);
  });
});

describe("acceptance 6: an error verdict leaves the counter unchanged", () => {
  it("forces a runner failure and proves the allowance came back", async () => {
    const problemId = await problemAt("medium");
    const before = await allowanceFor({
      enrolmentId: learner.enrolmentId, problemId, difficulty: "medium", scope: "submit_daily" });

    const submission = await createSubmission({ ...ctx(problemId), kind: "submit", body: "x" });

    const during = await allowanceFor({
      enrolmentId: learner.enrolmentId, problemId, difficulty: "medium", scope: "submit_daily" });
    expect(during.used).toBe(before.used + 1);

    // The runner fails. This is the shape lib/queue/runner-worker.ts produces
    // when the battery cannot start at all.
    await settle(submission.id, {
      verdict: "error",
      message: "The runner did not complete. Your attempt was not counted. Try again.",
      consumes_allowance: false,
    });

    const after = await allowanceFor({
      enrolmentId: learner.enrolmentId, problemId, difficulty: "medium", scope: "submit_daily" });
    expect(after.used).toBe(before.used);
    expect(after.remaining).toBe(before.remaining);
  });

  it("does the same for a timeout, which is also not the learner's fault", async () => {
    const problemId = await problemAt("medium");
    const submission = await createSubmission({ ...ctx(problemId), kind: "submit", body: "y" });
    await settle(submission.id, resultWith({ verdict: "timeout" }));

    const after = await allowanceFor({
      enrolmentId: learner.enrolmentId, problemId, difficulty: "medium", scope: "submit_daily" });
    expect(after.used).toBe(0);
  });

  it("still spends the allowance on a genuine fail", async () => {
    const problemId = await problemAt("medium");
    const submission = await createSubmission({ ...ctx(problemId), kind: "submit", body: "z" });
    await settle(submission.id, resultWith({ verdict: "fail" }));

    const after = await allowanceFor({
      enrolmentId: learner.enrolmentId, problemId, difficulty: "medium", scope: "submit_daily" });
    expect(after.used).toBe(1);
  });
});

describe("give-up unlocks L5 and records the choice", () => {
  it("keeps the walkthrough locked until the learner gives up", async () => {
    const problemId = await problemAt("medium");
    let policy = await resolvePolicy({ enrolmentId: learner.enrolmentId, problemId });
    expect(policy.layers.reference).toBe(false);
    expect(policy.giveUp.allowed).toBe(true);

    await giveUp({ ...ctx(problemId), reason: "stuck on the retry logic" });

    policy = await resolvePolicy({ enrolmentId: learner.enrolmentId, problemId });
    expect(policy.layers.reference).toBe(true);
    expect(policy.giveUp.allowed).toBe(false);

    const attempt = await db().query<{ gave_up_reason: string | null }>(
      `select gave_up_reason from attempt where enrolment_id = $1 and problem_id = $2`,
      [learner.enrolmentId, problemId]);
    expect(attempt.rows[0]!.gave_up_reason).toBe("stuck on the retry logic");

    const audit = await db().query(
      `select 1 from audit_log where action = 'attempt.give_up'`);
    expect(audit.rows).toHaveLength(1);
  });
});

describe("competency transitions, docs/02 section 7", () => {
  it("computes the state a submission earns", () => {
    expect(stateForSubmission({ verdict: "fail", hintsUsed: 0, llmCalls: 1, callBudget: 6 }))
      .toBe("attempted");
    expect(stateForSubmission({ verdict: "pass", hintsUsed: 0, llmCalls: 6, callBudget: 6 }))
      .toBe("clean");
    expect(stateForSubmission({ verdict: "pass", hintsUsed: 1, llmCalls: 1, callBudget: 6 }))
      .toBe("passed");
    expect(stateForSubmission({ verdict: "pass", hintsUsed: 0, llmCalls: 7, callBudget: 6 }))
      .toBe("passed");
  });

  it("moves one way only, so clean never degrades to passed", () => {
    expect(isUpgrade("untouched", "attempted")).toBe(true);
    expect(isUpgrade("attempted", "clean")).toBe(true);
    expect(isUpgrade("clean", "passed")).toBe(false);
    expect(isUpgrade("passed", "attempted")).toBe(false);
  });

  it("writes the transition when a submission finishes", async () => {
    const problemId = await problemAt("medium");
    const submission = await createSubmission({ ...ctx(problemId), kind: "submit", body: "x" });
    await settle(submission.id, resultWith({ verdict: "fail" }));

    let scores = await db().query<{ state: string }>(
      `select state from competency_score where enrolment_id = $1`, [learner.enrolmentId]);
    expect(scores.rows.length).toBeGreaterThan(0);
    expect(scores.rows.every((r) => r.state === "attempted")).toBe(true);

    const clean = await createSubmission({ ...ctx(problemId), kind: "submit", body: "better" });
    await settle(clean.id, resultWith({
      verdict: "pass", score: 100,
      budget: { llm_calls: 4, tool_calls: 1, wall_ms: 5, max_llm_calls: 6, within_budget: true },
    }));

    scores = await db().query<{ state: string }>(
      `select state from competency_score where enrolment_id = $1`, [learner.enrolmentId]);
    expect(scores.rows.every((r) => r.state === "clean")).toBe(true);
  });

  it("records passed rather than clean when a hint was revealed", async () => {
    const problemId = await problemAt("medium");
    const failed = await createSubmission({ ...ctx(problemId), kind: "run", body: "x" });
    await settle(failed.id, resultWith());
    await revealHint(ctx(problemId));

    const submission = await createSubmission({ ...ctx(problemId), kind: "submit", body: "y" });
    await settle(submission.id, resultWith({ verdict: "pass", score: 95 }));

    const scores = await db().query<{ state: string }>(
      `select state from competency_score where enrolment_id = $1`, [learner.enrolmentId]);
    expect(scores.rows.every((r) => r.state === "passed")).toBe(true);
  });
});

describe("the cap is enforced before the queue write", () => {
  it("leaves no submission and no outbox row when the cap refuses", async () => {
    const problemId = await problemAt("medium");
    await db().query(
      `update rate_limit_policy set max_count = 1
        where scope = 'submit_daily' and difficulty = 'medium'`);

    await createSubmission({ ...ctx(problemId), kind: "submit", body: "one" });
    await expect(createSubmission({ ...ctx(problemId), kind: "submit", body: "two" }))
      .rejects.toBeInstanceOf(RateLimitError);

    const rows = await db().query<{ submissions: string; outbox: string }>(
      `select (select count(*) from submission) as submissions,
              (select count(*) from outbox) as outbox`);
    expect(rows.rows[0]).toEqual({ submissions: "1", outbox: "1" });
  });
});
