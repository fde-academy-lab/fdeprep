/**
 * The re-evaluation drain. docs/10 section 9, docs/11 section 6.
 *
 * A partial evaluation is a promise of a free re-run, and until S15.3 nothing
 * ran one. The judge worker now does, a few per tick. These drive it through
 * judgeOnce, the worker's own tick, and through the real judge as a subprocess
 * with scripted replies standing in for Bedrock, so "the judge is back" means
 * the judge answering and "the judge is down" means it failing.
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../lib/db/pool.ts";
import { createSubmission } from "../lib/submissions/create.ts";
import { dispatchOnce } from "../lib/queue/dispatcher.ts";
import { writeResult } from "../lib/queue/result-writer.ts";
import { deleteMessage, receive } from "../lib/queue/shim.ts";
import { judgeOnce, type ReevaluationBackoff } from "../lib/queue/judge-worker.ts";
import { latestEvaluation, reevaluationBacklog, saveEvaluation } from "../lib/eval/record.ts";
import { runPanel, type Panelist } from "../lib/eval/panel.ts";
import type { Embed } from "../lib/eval/embed.ts";
import { EMBEDDING_MODEL } from "../lib/eval/embed.ts";
import { importFixtures, resetDatabase, seedLearner } from "./helpers.ts";

let previousModelDir: string | undefined;

beforeAll(async () => {
  previousModelDir = process.env["FDEPREP_EMBED_MODEL_DIR"];
  process.env["FDEPREP_EMBED_MODEL_DIR"] = await mkdtemp(path.join(tmpdir(), "fdeprep-no-model-"));
});

beforeEach(async () => {
  await resetDatabase();
  await importFixtures();
  delete process.env.JUDGE_SCRIPTED_REPLIES;
});

afterAll(async () => {
  delete process.env.JUDGE_SCRIPTED_REPLIES;
  if (previousModelDir === undefined) delete process.env["FDEPREP_EMBED_MODEL_DIR"];
  else process.env["FDEPREP_EMBED_MODEL_DIR"] = previousModelDir;
  await closeDb();
});

const ANSWER = `## What I would measure

The forty conversations were written by the people who built the agent, so they
cover the failures those people already imagined. I would measure the refund
rate against orders that do not exist, the rate of refunds above the ceiling,
and the share of conversations where the agent acts on text a customer pasted in.

## What I would refuse to launch without

A hard cap enforced outside the model, and an adversarial set of at least two
hundred cases drawn from real traffic rather than from imagination.`;

/** What the judge says once it is back: 32 + 28 + 18 of 100, a strong band. */
const RUBRIC_REPLY = JSON.stringify({ criteria: [
  { criterion_id: "c1", score: 32, evidence_quote: "written by the people who built the agent" },
  { criterion_id: "c2", score: 28, evidence_quote: "at least two hundred cases" },
  { criterion_id: "c3", score: 18, evidence_quote: "A hard cap enforced outside the model" },
] });

/**
 * A design result whose rubric ran and arrived with no score to read, so
 * panelist 3 is unavailable and the evaluation goes partial. `percent` says
 * whether the gate carries the judge's own field, which the previous release
 * did not read.
 */
function rubricWithoutScore(percent?: number): Record<string, unknown> {
  return {
    verdict: "pass",
    score: percent ?? 78,
    gates: {
      static: { status: "pass", checks: [] },
      probes: { status: "skipped", passed: 0, total: 0, cases: [] },
      rubric: { status: "pass", ...(percent === undefined ? {} : { percent }), threshold: 65,
                criteria: [{ criterion_id: "c1", score: 32, evidence_quote: "the forty",
                             quote_grounded: true }] },
    },
    model_calls: 1,
    consumes_allowance: true,
    requeue: false,
  };
}

let githubId = 0;

/** One learner, one design answer, committed through the result writer. */
async function committed(contract: Record<string, unknown>) {
  githubId += 1;
  const learner = await seedLearner({ githubId, login: `learner${githubId}` });
  const { rows } = await db().query<{ id: string }>(
    "select id from problem where slug = 'argue-the-eval-plan'");
  const submission = await createSubmission({
    enrolmentId: learner.enrolmentId, cohortId: learner.cohortId,
    problemId: Number(rows[0]!.id), kind: "submit", body: ANSWER,
  });
  await dispatchOnce();
  const [message] = await receive("judgements", 1);
  expect(await writeResult({
    submission_id: submission.id,
    lease_token: String(message!.body["lease_token"]),
    fencing_token: Number(message!.body["fencing_token"]),
    body_sha256: submission.bodySha256,
    result: contract,
  })).toBe(true);
  await deleteMessage(message!.id);
  return { submissionId: submission.id, problemId: Number(rows[0]!.id), ...learner };
}

/**
 * A partial written the way the previous release wrote one for a real design
 * answer: the judge's `percent` was on the gate and panelist 3 did not read it.
 */
async function legacyPartial() {
  const learner = await committed(rubricWithoutScore(78));
  const seat = (name: Panelist["name"], result: Awaited<ReturnType<Panelist["run"]>>): Panelist =>
    ({ name, run: async () => result });
  await saveEvaluation(await runPanel({
    submissionId: learner.submissionId, complexity: "C4", artefactType: "design",
    body: ANSWER, problemSlug: "argue-the-eval-plan",
  }, [
    seat("static", { status: "ran", ms: 0, findings: [], verdict: "pass", scoreContribution: 78 }),
    seat("pretrained", { status: "skipped", reason: "model_missing", ms: 0, findings: [] }),
    seat("llm", { status: "unavailable", reason: "no_rubric_score", ms: 0, findings: [] }),
  ]), learner.enrolmentId);
  return learner;
}

async function allowanceSpent(enrolmentId: number): Promise<number> {
  const { rows } = await db().query<{ total: string }>(
    "select coalesce(sum(count), 0) as total from rate_limit_counter where enrolment_id = $1",
    [enrolmentId]);
  return Number(rows[0]!.total);
}

async function rows(submissionId: number): Promise<Array<{ state: string; judge_prompt: string | null }>> {
  const { rows: found } = await db().query<{ state: string; judge_prompt: string | null }>(
    `select state::text, judge_prompt from evaluation where submission_id = $1
      order by created_at, id`, [submissionId]);
  return found;
}

describe("a partial evaluation is re-run for free when the judge is back", () => {
  it("becomes complete through the judge worker and spends no allowance", async () => {
    const { submissionId, enrolmentId } = await committed(rubricWithoutScore());
    expect((await latestEvaluation(submissionId))!.state).toBe("partial");
    const spent = await allowanceSpent(enrolmentId);

    process.env.JUDGE_SCRIPTED_REPLIES = JSON.stringify([RUBRIC_REPLY]);
    await judgeOnce({ backoff: new Map() });

    const newest = await latestEvaluation(submissionId);
    expect(newest).toMatchObject({
      state: "complete", verdict: "pass", scoreProvisional: false,
      judgePrompt: "rubric.v1.md", band: "strong",
    });
    // Appended, never edited: the outage stays on the record.
    expect(await rows(submissionId)).toEqual([
      { state: "partial", judge_prompt: null },
      { state: "complete", judge_prompt: "rubric.v1.md" },
    ]);
    expect(await allowanceSpent(enrolmentId)).toBe(spent);
    expect(await reevaluationBacklog()).not.toContain(submissionId);

    const { rows: [submission] } = await db().query<{ verdict: string; result: Record<string, any> }>(
      "select verdict::text, result from submission where id = $1", [submissionId]);
    expect(submission!.verdict).toBe("pass");
    expect(submission!.result["evaluation"]).toEqual(
      { state: "complete", confidence: "medium", provisional: false });
    expect(submission!.result["feedback_md"]).not.toContain("still running");
  });

  it("writes nothing while the judge is down, and waits before trying again", async () => {
    const { submissionId } = await committed(rubricWithoutScore());
    const backoff: ReevaluationBackoff = new Map();

    // No scripted reply: the judge raises on its first call, which is an
    // outage as far as the worker can tell.
    process.env.JUDGE_SCRIPTED_REPLIES = JSON.stringify([]);
    await judgeOnce({ backoff });
    expect(await rows(submissionId)).toEqual([{ state: "partial", judge_prompt: null }]);
    expect(backoff.get(submissionId)?.failures).toBe(1);

    // Back, but the submission is still inside its wait, so this tick leaves it.
    process.env.JUDGE_SCRIPTED_REPLIES = JSON.stringify([RUBRIC_REPLY]);
    await judgeOnce({ backoff });
    expect(await rows(submissionId)).toHaveLength(1);

    backoff.clear();
    await judgeOnce({ backoff });
    expect((await latestEvaluation(submissionId))!.state).toBe("complete");
  });
});

describe("what a re-run costs", () => {
  it("finishes an old partial from the judgement already on the record, with no model call", async () => {
    // No reply is scripted, so a call to the judge would fail and leave this
    // partial. Completing it proves the stored judgement was read instead.
    const { submissionId } = await legacyPartial();
    process.env.JUDGE_SCRIPTED_REPLIES = JSON.stringify([]);

    await judgeOnce({ backoff: new Map() });

    expect((await latestEvaluation(submissionId))).toMatchObject(
      { state: "complete", band: "strong" });
  });

  it("re-runs no more than the bound in one tick", async () => {
    const owed = [await legacyPartial(), await legacyPartial(), await legacyPartial()];
    const backoff: ReevaluationBackoff = new Map();

    await judgeOnce({ backoff, reevaluationsPerTick: 2 });
    expect(await reevaluationBacklog()).toEqual([owed[2]!.submissionId]);

    await judgeOnce({ backoff, reevaluationsPerTick: 2 });
    expect(await reevaluationBacklog()).toEqual([]);
  });
});

describe("panelist 2 re-run", () => {
  it("runs again when it was the one missing, and never counts the answer as its own neighbour", async () => {
    const learner = await committed(rubricWithoutScore(90));
    const { submissionId, problemId, enrolmentId } = learner;

    // The partial: the encoder timed out and the judge's band landed.
    await saveEvaluation(await runPanel({
      submissionId, complexity: "C4", artefactType: "design", body: ANSWER,
      problemSlug: "argue-the-eval-plan",
    }, [
      { name: "static", run: async () => ({ status: "ran", ms: 0, findings: [], verdict: "pass",
                                            scoreContribution: 90 }) },
      { name: "pretrained", run: async () => ({ status: "unavailable", reason: "timeout", ms: 0,
                                                findings: [] }) },
      { name: "llm", run: async () => ({ status: "ran", ms: 0, findings: [], band: "strong",
                                         prompt: "rubric.v1.md" }) },
    ]), enrolmentId);

    // The answer encodes to exactly the vector its own row in the pool holds,
    // so that row is its nearest neighbour by far and carries a band nothing
    // else does. Counted, it would outvote the three authored exemplars, which
    // sit at similarities 0.5, 0.45 and 0.4 and vote strong between them.
    const same: Embed = async (texts) => ({ ok: true, vectors: texts.map(() => [1, 0, 0]) });
    const authored: Array<[string, number[]]> = [
      ["strong", [0.5, Math.sqrt(1 - 0.25), 0]],
      ["adequate", [0.45, Math.sqrt(1 - 0.2025), 0]],
      ["weak", [0.4, Math.sqrt(1 - 0.16), 0]],
    ];
    for (const [band, vector] of authored) {
      await db().query(
        `insert into embedding (problem_id, band, source, vector, model)
         values ($1, $2, 'exemplar', $3, $4)`, [problemId, band, vector, EMBEDDING_MODEL]);
    }
    await db().query(
      `insert into embedding (problem_id, band, source, submission_id, vector, model)
       values ($1, 'off_question', 'submission', $2, $3, $4)`,
      [problemId, submissionId, [1, 0, 0], EMBEDDING_MODEL]);

    await judgeOnce({ backoff: new Map(), embed: same });

    const newest = await latestEvaluation(submissionId);
    expect(newest!.state).toBe("complete");
    const p2 = newest!.panel.find((p) => p.panelist === "pretrained");
    expect(p2).toMatchObject({ status: "ran", band: "strong" });
    // The judge's seat came across as it was, prompt and all.
    expect(newest!.judgePrompt).toBe("rubric.v1.md");
  });
});
