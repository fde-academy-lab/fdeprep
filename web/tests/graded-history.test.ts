/**
 * The attempt history behind Progress, Home, the CSV export and the faculty
 * learner page reads graded kinds only: a submit and a rehearsal submit.
 *
 * Found on 8 October 2026 by reading. The history took the latest submission
 * of any kind for its result and the lowest call count of any passing
 * submission for its best budget, so a Run that passed the public cases read
 * Passed, and the Run's call count, over the public cases alone, read as the
 * budget to beat. A Run is practice against the public cases (docs/00 section
 * 4) and says nothing about the hidden ones, which is why it earns no more
 * than attempted on the heatmap (docs/02 section 7).
 *
 * Written before the fix. What these pin down: the result, the submit count
 * and the best budget read submits and rehearsal submits; a problem with Runs
 * and no submit reads as not submitted yet and still shows when it was last
 * worked on; and progress/ stays a reader.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { RecentActivity } from "../components/home/sections.tsx";
import { closeDb, db } from "../lib/db/pool.ts";
import { attemptHistory, historyCsv } from "../lib/progress/index.ts";
import { recentActivity } from "../lib/progress/summary.ts";
import { createSubmission, type RunKind } from "../lib/submissions/create.ts";
import { dispatchOnce } from "../lib/queue/dispatcher.ts";
import { writeResult } from "../lib/queue/result-writer.ts";
import { deleteMessage, receive } from "../lib/queue/shim.ts";
import { importFixtures, resetDatabase, seedLearner } from "./helpers.ts";

const SLUG = "echo-the-question";
const NOTHING = { status: "skipped", passed: 0, total: 0, cases: [] };

let learner: Awaited<ReturnType<typeof seedLearner>>;
let problemId: number;

beforeEach(async () => {
  await resetDatabase();
  await importFixtures();
  learner = await seedLearner();
  const { rows } = await db().query<{ id: string }>("select id from problem where slug = $1", [SLUG]);
  problemId = Number(rows[0]!.id);
});

afterAll(async () => {
  await closeDb();
});

async function sitting(): Promise<number> {
  const { rows } = await db().query<{ id: string }>(
    `insert into rehearsal (enrolment_id, ends_at, problem_ids)
     values ($1, now() + interval '1 hour', array[$2::bigint]) returning id`,
    [learner.enrolmentId, problemId]);
  return Number(rows[0]!.id);
}

/** Create a submission of `kind` and, given a result, write it as the runner's. */
async function make(kind: RunKind, result?: Record<string, unknown>, rehearsalId?: number) {
  const created = await createSubmission({
    enrolmentId: learner.enrolmentId, cohortId: learner.cohortId, problemId, kind, rehearsalId,
    body: `def run_agent(question, llm, tools):\n    return question  # ${Math.random()}\n`,
  });
  if (!result) return created.id;
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

const budget = (calls: number) =>
  ({ llm_calls: calls, tool_calls: 1, wall_ms: 20, max_llm_calls: 6, within_budget: true });
const PUBLIC_PASS = { status: "pass", passed: 2, total: 2, cases: [] };

/** A Run's pass, which covers the public cases alone, in one model call. */
const RUN_PASS = {
  verdict: "pass", score: null,
  gates: { static: { status: "pass", reasons: [] }, public: PUBLIC_PASS,
           hidden: NOTHING, adversarial: NOTHING },
  steps: [], budget: budget(1), runner: { image_tag: "runner:test", duration_ms: 10 },
};
const SUBMIT_FAIL = {
  verdict: "fail", score: 65,
  gates: { static: { status: "pass", reasons: [] }, public: PUBLIC_PASS,
           hidden: { status: "fail", passed: 1, total: 2, cases: [] }, adversarial: NOTHING },
  steps: [], budget: budget(4), runner: { image_tag: "runner:test", duration_ms: 10 },
};
const SUBMIT_PASS = {
  ...SUBMIT_FAIL, verdict: "pass", score: 100,
  gates: { ...SUBMIT_FAIL.gates, hidden: { status: "pass", passed: 2, total: 2, cases: [] } },
  budget: budget(3),
};

const row = async () => (await attemptHistory(learner.enrolmentId)).find((r) => r.slug === SLUG)!;
const csvLine = async () => (await historyCsv(learner.enrolmentId)).trim().split("\n")[1]!.split(",");

describe("a problem with Runs and no submit", () => {
  it("reads as not submitted yet, whatever the Run said, and keeps when it was worked on", async () => {
    await make("run", RUN_PASS);

    const history = await row();
    expect(history).toMatchObject({ verdict: null, submitted: false, submits: 0, bestBudgetCalls: null });
    expect(history.lastAt).not.toBeNull();

    const [date, , , verdict, submits, , calls] = await csvLine();
    expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect([verdict, submits, calls]).toEqual(["not submitted yet", "0", ""]);

    const rows = await recentActivity(learner.enrolmentId);
    expect(rows[0]).toMatchObject({ slug: SLUG, verdict: null, submitted: false, submits: 0 });
    const home = renderToStaticMarkup(createElement(RecentActivity, { rows }));
    expect(home).toContain("Not submitted yet");
    expect(home).not.toMatch(/Passed|Not yet</);
  });
});

describe("a problem with a submit", () => {
  it("reads the latest submit's verdict past a later Run's pass", async () => {
    await make("submit", SUBMIT_FAIL);
    await make("run", RUN_PASS);

    expect(await row()).toMatchObject({ verdict: "fail", submitted: true, submits: 1, bestBudgetCalls: null });
    expect((await csvLine())[3]).toBe("fail");
    expect((await recentActivity(learner.enrolmentId))[0]).toMatchObject({ verdict: "fail", submitted: true });
  });

  it("takes the best budget from passing submits, never from a Run", async () => {
    await make("submit", SUBMIT_PASS);
    await make("run", RUN_PASS);

    expect(await row()).toMatchObject({ verdict: "pass", bestBudgetCalls: 3 });
    expect((await csvLine())[6]).toBe("3 of 6");
  });

  it("counts a rehearsal submit as a submit", async () => {
    await make("rehearsal_submit", SUBMIT_PASS, await sitting());

    expect(await row()).toMatchObject({ verdict: "pass", submitted: true, submits: 1, bestBudgetCalls: 3 });
  });

  it("reads a submit still waiting for its verdict as waiting, past a finished Run", async () => {
    await make("run", RUN_PASS);
    await make("submit");

    expect(await row()).toMatchObject({ verdict: null, submitted: true, submits: 1 });
  });
});
