/**
 * docs/00 section 3.2: what a learner reads of the hidden and adversarial
 * batteries is a tier rule. Easy, Medium and Hard show the hidden count, and
 * Extreme and screen conditions show nothing about the tests.
 *
 * Found on 8 October 2026 by reading. The results view returned the hidden and
 * adversarial counts on every tier and the Attempts tab printed them, so an
 * Extreme submit or a rehearsal submit read "1/2 hidden" on the screens whose
 * tier promises nothing about the tests. The result pane kept the hidden count
 * off Extreme and still drew the adversarial one.
 *
 * Written before the fix. What these pin down: the view asks the policy module
 * which tier a submission was graded under and reports what that tier shows;
 * the Attempts tab reads the same answer; and while a learner sits a rehearsal
 * that holds a problem, every result on it reads under screen conditions.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../lib/db/pool.ts";
import { createSubmission, type RunKind } from "../lib/submissions/create.ts";
import { dispatchOnce } from "../lib/queue/dispatcher.ts";
import { writeResult } from "../lib/queue/result-writer.ts";
import { deleteMessage, receive } from "../lib/queue/shim.ts";
import { publicView } from "../lib/submissions/view.ts";
import { attemptHistory } from "../lib/problems/workspace.ts";
import { importFixtures, resetDatabase, seedLearner } from "./helpers.ts";

// Fixture problems, one per kind of rule. Their tiers are the fixtures' own.
const COUNTED = "retry-once-then-degrade";
const NOTHING_SHOWN = "survive-the-hostile-tool";
const REHEARSED = "echo-the-question";

let learner: Awaited<ReturnType<typeof seedLearner>>;

beforeEach(async () => {
  await resetDatabase();
  await importFixtures();
  learner = await seedLearner();
});

afterAll(async () => {
  await closeDb();
});

async function problemId(slug: string): Promise<number> {
  const { rows } = await db().query<{ id: string }>("select id from problem where slug = $1", [slug]);
  return Number(rows[0]!.id);
}

/** A learner test with an assertion, which some tiers ask for before a submit. */
async function learnerTest(id: number): Promise<void> {
  const { rows: [attempt] } = await db().query<{ id: string }>(
    `insert into attempt (enrolment_id, problem_id, cohort_id) values ($1, $2, $3)
     on conflict (enrolment_id, problem_id) do update set problem_id = excluded.problem_id
     returning id`, [learner.enrolmentId, id, learner.cohortId]);
  await db().query("insert into learner_test (attempt_id, body) values ($1, $2)",
    [attempt!.id, "def test_answers():\n    assert run_agent('q', llm, tools)"]);
}

async function sitting(id: number): Promise<number> {
  const { rows } = await db().query<{ id: string }>(
    `insert into rehearsal (enrolment_id, ends_at, problem_ids)
     values ($1, now() + interval '1 hour', array[$2::bigint]) returning id`,
    [learner.enrolmentId, id]);
  return Number(rows[0]!.id);
}

const finish = (rehearsalId: number) =>
  db().query("update rehearsal set finished_at = now() where id = $1", [rehearsalId]);

async function create(id: number, kind: RunKind, rehearsalId?: number): Promise<number> {
  const created = await createSubmission({
    enrolmentId: learner.enrolmentId, cohortId: learner.cohortId, problemId: id, kind,
    body: `def run_agent(question, llm, tools):\n    return question  # ${Math.random()}\n`,
    rehearsalId,
  });
  return created.id;
}

/** Claim the dispatched message for one submission and write a scripted result. */
async function grade(submissionId: number, result: Record<string, unknown>): Promise<void> {
  await dispatchOnce();
  const message = (await receive("submissions", 10))
    .find((m) => Number(m.body["submission_id"]) === submissionId)!;
  expect(await writeResult({
    submission_id: submissionId,
    lease_token: String(message.body["lease_token"]),
    fencing_token: Number(message.body["fencing_token"]),
    body_sha256: String(message.body["body_sha256"]),
    result,
  })).toBe(true);
  await deleteMessage(message.id);
}

type Gate = { status: string; passed: number; total: number; cases: unknown[] };

/** A submit's result as the runner returns one: public passed, then the two unpublished gates. */
function result(hidden: Gate, adversarial: Gate): Record<string, unknown> {
  return {
    verdict: hidden.status === "pass" && adversarial.status !== "fail" ? "pass" : "fail",
    score: 51.25,
    gates: {
      static: { status: "pass", reasons: [] },
      public: { status: "pass", passed: 2, total: 2,
                cases: [{ name: "public_one", status: "pass", message: null },
                        { name: "public_two", status: "pass", message: null }] },
      hidden, adversarial,
    },
    steps: [],
    budget: { llm_calls: 2, tool_calls: 1, wall_ms: 30, max_llm_calls: 6, within_budget: true },
    runner: { image_tag: "runner:test", duration_ms: 40 },
  };
}

const HIDDEN_FAILS = { status: "fail", passed: 1, total: 2, cases: [] };
const HIDDEN_PASSES = { status: "pass", passed: 2, total: 2, cases: [] };
const ADVERSARIAL_FAILS = { status: "fail", passed: 0, total: 1, cases: [] };
const NONE_RAN = { status: "skipped", passed: 0, total: 0, cases: [] };

describe("a tier that shows the hidden count", () => {
  it("reports the hidden count in the view and in the Attempts tab", async () => {
    const id = await problemId(COUNTED);
    const submit = await create(id, "submit");
    await grade(submit, result(HIDDEN_FAILS, NONE_RAN));

    const view = await publicView(submit);
    expect(view.unpublishedCounts).toBe(true);
    expect(view.gates.hidden).toEqual({ status: "fail", passed: 1, total: 2, cases: [] });

    const [row] = (await attemptHistory(learner.enrolmentId, id)).submissions;
    expect(row).toMatchObject({ kind: "submit", hiddenPassed: 1, hiddenTotal: 2 });
  });

  it("still names the hidden cases once the problem is passed, as docs/03 section 5 says", async () => {
    const id = await problemId(COUNTED);
    const submit = await create(id, "submit");
    await grade(submit, result({
      ...HIDDEN_FAILS, cases: [{ name: "hidden_one", status: "pass", message: null },
                               { name: "hidden_two", status: "fail", message: "returns_nonempty" }],
    }, NONE_RAN));
    await db().query("update attempt set solved_at = now() where enrolment_id = $1",
      [learner.enrolmentId]);

    const view = await publicView(submit);
    expect(view.gates.hidden.cases.map((c) => c.name)).toEqual(["hidden_one", "hidden_two"]);
  });
});

describe("a tier that shows nothing about the tests", () => {
  it("withholds both counts on Extreme and keeps whether each battery passed", async () => {
    const id = await problemId(NOTHING_SHOWN);
    await learnerTest(id);
    const submit = await create(id, "submit");
    await grade(submit, result(HIDDEN_PASSES, ADVERSARIAL_FAILS));

    const view = await publicView(submit);
    expect(view.unpublishedCounts).toBe(false);
    expect(view.gates.hidden).toEqual({ status: "pass", passed: 0, total: 0, cases: [] });
    expect(view.gates.adversarial).toEqual({ status: "fail", passed: 0, total: 0, cases: [] });
    // What is not about the unpublished cases stays: the verdict, the score
    // and the public gate.
    expect(view.verdict).toBe("fail");
    expect(view.score).toBe(51.25);
    expect(view.gates.public.total).toBe(2);
  });

  it("lists an Extreme submit in the Attempts tab with no hidden count", async () => {
    const id = await problemId(NOTHING_SHOWN);
    await learnerTest(id);
    const submit = await create(id, "submit");
    await grade(submit, result(HIDDEN_PASSES, ADVERSARIAL_FAILS));

    const [row] = (await attemptHistory(learner.enrolmentId, id)).submissions;
    expect(row).toMatchObject({ id: submit, kind: "submit", publicPassed: 2, publicTotal: 2,
                                hiddenPassed: null, hiddenTotal: null, score: 51.25 });
  });

  it("names no hidden case on Extreme, even once the problem is passed", async () => {
    const id = await problemId(NOTHING_SHOWN);
    await learnerTest(id);
    const submit = await create(id, "submit");
    // What the runner stores for a learner who had already passed: the names.
    await grade(submit, result({
      ...HIDDEN_PASSES, cases: [{ name: "hidden_one", status: "pass", message: null },
                                { name: "hidden_two", status: "pass", message: null }],
    }, { status: "pass", passed: 1, total: 1,
         cases: [{ name: "adversarial_injection", status: "pass", message: null }] }));
    await db().query("update attempt set solved_at = now() where enrolment_id = $1",
      [learner.enrolmentId]);

    const text = JSON.stringify(await publicView(submit));
    for (const name of ["hidden_one", "hidden_two", "adversarial_injection"]) {
      expect(text).not.toContain(name);
    }
  });

  it("withholds both counts from a rehearsal submit on any tier, after the sitting too", async () => {
    const id = await problemId(REHEARSED);
    const rehearsalId = await sitting(id);
    const submit = await create(id, "rehearsal_submit", rehearsalId);
    await grade(submit, result(HIDDEN_FAILS, NONE_RAN));
    await finish(rehearsalId);

    const view = await publicView(submit);
    expect(view.unpublishedCounts).toBe(false);
    expect(view.gates.hidden).toEqual({ status: "fail", passed: 0, total: 0, cases: [] });
    const [row] = (await attemptHistory(learner.enrolmentId, id)).submissions;
    expect(row).toMatchObject({ kind: "rehearsal_submit", hiddenPassed: null, hiddenTotal: null });

    // The full battery still ran and is on the record for faculty.
    const { rows: [stored] } = await db().query<{ hidden_passed: number; hidden_total: number }>(
      "select hidden_passed, hidden_total from submission where id = $1", [submit]);
    expect(stored).toEqual({ hidden_passed: 1, hidden_total: 2 });
  });
});

describe("a learner sitting a rehearsal", () => {
  it("reads every result on a problem the sitting holds under screen conditions, until it ends", async () => {
    // A practice submit made before the sitting, on a tier that shows the count.
    const id = await problemId(COUNTED);
    const practice = await create(id, "submit");
    await grade(practice, result(HIDDEN_FAILS, NONE_RAN));

    const rehearsalId = await sitting(id);
    expect((await publicView(practice)).gates.hidden.total).toBe(0);
    expect((await attemptHistory(learner.enrolmentId, id)).submissions[0])
      .toMatchObject({ hiddenPassed: null, hiddenTotal: null });

    await finish(rehearsalId);
    expect((await publicView(practice)).gates.hidden.total).toBe(2);
    expect((await attemptHistory(learner.enrolmentId, id)).submissions[0])
      .toMatchObject({ hiddenPassed: 1, hiddenTotal: 2 });
  });

  it("leaves results on a problem the sitting does not hold alone", async () => {
    const id = await problemId(COUNTED);
    const practice = await create(id, "submit");
    await grade(practice, result(HIDDEN_FAILS, NONE_RAN));
    await sitting(await problemId(REHEARSED));

    expect((await publicView(practice)).gates.hidden.total).toBe(2);
  });
});
