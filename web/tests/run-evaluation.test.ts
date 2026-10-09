/**
 * docs/10: eval/ turns a submission into a graded evaluation, and docs/02
 * section 4 gives a graded submission its evaluation rows. A Run is not
 * graded: it executes the public cases and carries no score (docs/03 section
 * 1.2).
 *
 * Found on 8 October 2026 by reading. The result writer ran the panel over
 * every finished submission, and panelist 1 read a null score as 0, so every
 * Run left an evaluation record with a score of 0. At up to 30 Runs an hour
 * those rows went into the report card's evaluation count, a document a
 * placement team reads, and into the panel's own numbers.
 *
 * Written before the fix. What these pin down: a Run gets no evaluation
 * record, and a submit and a defence still do; the Run still moves its
 * competency cell to attempted, which eval/ writes; and a result with no score
 * gives an evaluation with no score.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../lib/db/pool.ts";
import { buildReportCard } from "../lib/analytics/report-card.ts";
import { staticPanelist } from "../lib/eval/from-result.ts";
import { runPanel } from "../lib/eval/panel.ts";
import { seedTracks } from "../lib/policy/roadmap.ts";
import { createSubmission, type RunKind } from "../lib/submissions/create.ts";
import { dispatchOnce } from "../lib/queue/dispatcher.ts";
import { writeResult } from "../lib/queue/result-writer.ts";
import { deleteMessage, receive } from "../lib/queue/shim.ts";
import { importFixtures, resetDatabase, seedLearner } from "./helpers.ts";

const SLUG = "echo-the-question";
const NOTHING = { status: "skipped", passed: 0, total: 0, cases: [] };
const PUBLIC_PASS = { status: "pass", passed: 2, total: 2, cases: [] };
const BUDGET = { llm_calls: 2, tool_calls: 1, wall_ms: 20, max_llm_calls: 6, within_budget: true };

const RUN_PASS = {
  verdict: "pass", score: null,
  gates: { static: { status: "pass", reasons: [] }, public: PUBLIC_PASS,
           hidden: NOTHING, adversarial: NOTHING },
  steps: [], budget: BUDGET, runner: { image_tag: "runner:test", duration_ms: 10 },
};
const SUBMIT_FAIL = {
  ...RUN_PASS, verdict: "fail", score: 65,
  gates: { ...RUN_PASS.gates, hidden: { status: "fail", passed: 1, total: 2, cases: [] } },
};

let learner: Awaited<ReturnType<typeof seedLearner>>;
let problemId: number;

beforeEach(async () => {
  await resetDatabase();
  await importFixtures();
  await seedTracks();
  learner = await seedLearner();
  const { rows } = await db().query<{ id: string }>("select id from problem where slug = $1", [SLUG]);
  problemId = Number(rows[0]!.id);
});

afterAll(async () => {
  await closeDb();
});

async function graded(kind: RunKind, result: Record<string, unknown>): Promise<number> {
  const created = await createSubmission({
    enrolmentId: learner.enrolmentId, cohortId: learner.cohortId, problemId, kind,
    body: `def run_agent(question, llm, tools):\n    return question  # ${Math.random()}\n`,
  });
  await dispatchOnce();
  const message = (await receive("submissions", 10))
    .find((m) => Number(m.body["submission_id"]) === created.id)!;
  expect(await writeResult({
    submission_id: created.id,
    lease_token: String(message.body["lease_token"]),
    fencing_token: Number(message.body["fencing_token"]),
    body_sha256: String(message.body["body_sha256"]),
    result,
  })).toBe(true);
  await deleteMessage(message.id);
  return created.id;
}

const evaluations = async (submissionId: number) => (await db().query<{ score: string | null }>(
  "select score from evaluation where submission_id = $1", [submissionId])).rows;

describe("which submissions get an evaluation record", () => {
  it("writes none for a Run, and one for a submit", async () => {
    const run = await graded("run", RUN_PASS);
    const submit = await graded("submit", SUBMIT_FAIL);

    expect(await evaluations(run)).toEqual([]);
    expect((await evaluations(submit)).map((e) => Number(e.score))).toEqual([65]);
    // The report card counts what was graded, and a Run was not.
    expect((await buildReportCard(learner.enrolmentId)).evaluations).toBe(1);
  });

  it("still lets the Run move its competency cell to attempted, through eval/", async () => {
    await graded("run", RUN_PASS);
    const { rows } = await db().query<{ state: string }>(
      "select state from competency_score where enrolment_id = $1", [learner.enrolmentId]);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.state === "attempted")).toBe(true);
  });

  it("leaves the Run's result without an evaluation block, since nothing evaluated it", async () => {
    const run = await graded("run", RUN_PASS);
    const { rows: [row] } = await db().query<{ result: Record<string, unknown> }>(
      "select result from submission where id = $1", [run]);
    expect(row!.result).not.toHaveProperty("evaluation");
    expect(row!.result).not.toHaveProperty("feedback_md");
  });
});

describe("a result with no score", () => {
  it("gives an evaluation with no score", async () => {
    const evaluation = await runPanel(
      { submissionId: 1, complexity: "C1", artefactType: "code", body: "x", problemSlug: SLUG },
      [staticPanelist(RUN_PASS)]);
    expect(evaluation.verdict).toBe("pass");
    expect(evaluation.score).toBeNull();
  });
});
