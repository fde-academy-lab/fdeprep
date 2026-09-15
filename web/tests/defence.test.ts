/**
 * The defence step. docs/03 section 4.4.
 *
 * One criterion, a 120-word cap, on Hard and Extreme code problems after a
 * pass. The attempt is not complete until it is submitted, which is why the
 * gate is checked on the server rather than only drawn in the UI.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../lib/db/pool.ts";
import { createSubmission, GateRefused } from "../lib/submissions/create.ts";
import { dispatchOnce } from "../lib/queue/dispatcher.ts";
import { judgeOnce } from "../lib/queue/judge-worker.ts";
import { writeResultsOnce } from "../lib/queue/runner-worker.ts";
import { resolvePolicy } from "../lib/policy/index.ts";
import { importFixtures, resetDatabase, seedLearner } from "./helpers.ts";

let learner: Awaited<ReturnType<typeof seedLearner>>;

beforeEach(async () => {
  await resetDatabase();
  learner = await seedLearner();
  await importFixtures();
  delete process.env.JUDGE_SCRIPTED_REPLIES;
});

afterAll(async () => {
  delete process.env.JUDGE_SCRIPTED_REPLIES;
  await closeDb();
});

async function problemBySlug(slug: string) {
  const { rows } = await db().query<{ id: string }>(
    "select id from problem where slug = $1", [slug]);
  return Number(rows[0]!.id);
}

/** Mark the attempt solved the way a passing battery would. */
async function markSolved(problemId: number) {
  await db().query(
    `insert into attempt (enrolment_id, problem_id, cohort_id, solved_at)
     values ($1, $2, $3, now())
     on conflict (enrolment_id, problem_id) do update set solved_at = now()`,
    [learner.enrolmentId, problemId, learner.cohortId]);
}

describe("when the defence opens", () => {
  it("stays shut on a Hard problem the learner has not passed", async () => {
    const problemId = await problemBySlug("count-the-failures");
    const policy = await resolvePolicy({ enrolmentId: learner.enrolmentId, problemId });

    expect(policy.defence.required).toBe(true);
    expect(policy.defence.open).toBe(false);
    expect(policy.defence.reason).toContain("passes");
  });

  it("opens once the problem is passed", async () => {
    const problemId = await problemBySlug("count-the-failures");
    await markSolved(problemId);
    const policy = await resolvePolicy({ enrolmentId: learner.enrolmentId, problemId });

    expect(policy.defence.open).toBe(true);
    expect(policy.defence.reason).toBeNull();
  });

  it("never applies to an Easy problem", async () => {
    const problemId = await problemBySlug("echo-the-question");
    await markSolved(problemId);
    const policy = await resolvePolicy({ enrolmentId: learner.enrolmentId, problemId });
    expect(policy.defence.required).toBe(false);
  });

  it("never applies to a prompt problem, which has no solution to defend", async () => {
    const problemId = await problemBySlug("harden-the-leaky-prompt");
    await markSolved(problemId);
    const policy = await resolvePolicy({ enrolmentId: learner.enrolmentId, problemId });
    expect(policy.defence.required).toBe(false);
  });
});

describe("the server refuses a defence the UI would not have offered", () => {
  it("rejects one before a pass, naming what has to happen first", async () => {
    const problemId = await problemBySlug("count-the-failures");
    await expect(createSubmission({
      enrolmentId: learner.enrolmentId, cohortId: learner.cohortId, problemId,
      kind: "defence", body: "I counted what the trace said, not what the tool claimed.",
    })).rejects.toBeInstanceOf(GateRefused);
  });

  it("rejects one on a problem with no defence step", async () => {
    const problemId = await problemBySlug("echo-the-question");
    await markSolved(problemId);
    await expect(createSubmission({
      enrolmentId: learner.enrolmentId, cohortId: learner.cohortId, problemId,
      kind: "defence", body: "Anything.",
    })).rejects.toBeInstanceOf(GateRefused);
  });
});

describe("judging a defence", () => {
  const GOOD = "Counting what the tool reported would have counted its own successes, " +
    "because a soft error returns a success status with an error body. I count the " +
    "trace steps whose body carries an error marker instead.";

  it("scores it, records it on the attempt and completes the step", async () => {
    const problemId = await problemBySlug("count-the-failures");
    await markSolved(problemId);

    const submission = await createSubmission({
      enrolmentId: learner.enrolmentId, cohortId: learner.cohortId, problemId,
      kind: "defence", body: GOOD,
    });
    process.env.JUDGE_SCRIPTED_REPLIES = JSON.stringify([
      JSON.stringify({ criteria: [{ criterion_id: "d1", score: 74,
        evidence_quote: "a soft error returns a success status" }] }),
    ]);
    await dispatchOnce();
    await judgeOnce();
    await writeResultsOnce();

    const { rows } = await db().query<{ defence_score: string; defence_body: string }>(
      `select defence_score, defence_body from attempt
        where enrolment_id = $1 and problem_id = $2`, [learner.enrolmentId, problemId]);
    expect(Number(rows[0]!.defence_score)).toBe(74);
    expect(rows[0]!.defence_body).toBe(GOOD);

    const policy = await resolvePolicy({ enrolmentId: learner.enrolmentId, problemId });
    expect(policy.defence.submitted).toBe(true);
    expect(policy.defence.open).toBe(false);
  });

  it("refuses one over the 120-word cap without a model call", async () => {
    const problemId = await problemBySlug("count-the-failures");
    await markSolved(problemId);

    const submission = await createSubmission({
      enrolmentId: learner.enrolmentId, cohortId: learner.cohortId, problemId,
      kind: "defence", body: Array.from({ length: 130 }, () => "word").join(" "),
    });
    process.env.JUDGE_SCRIPTED_REPLIES = "[]";
    await dispatchOnce();
    await judgeOnce();
    await writeResultsOnce();

    const { rows } = await db().query<{ verdict: string; result: { model_calls: number } }>(
      "select verdict::text, result from submission where id = $1", [submission.id]);
    expect(rows[0]!.verdict).toBe("fail");
    expect(rows[0]!.result.model_calls).toBe(0);
  });

  it("does not spend a submit allowance, because it is asked after a pass", async () => {
    const problemId = await problemBySlug("count-the-failures");
    await markSolved(problemId);
    await createSubmission({
      enrolmentId: learner.enrolmentId, cohortId: learner.cohortId, problemId,
      kind: "defence", body: GOOD,
    });

    const { rows } = await db().query<{ scope: string; count: number }>(
      "select scope::text, count from rate_limit_counter where enrolment_id = $1",
      [learner.enrolmentId]);
    expect(rows.map((r) => r.scope)).toEqual(["defence_daily"]);
  });
});

describe("the submissions route", () => {
  it("keeps the defence kind rather than turning it into a run", async () => {
    // A route that collapsed every kind to run or submit would charge a
    // defence against the run cap and hand it to the runner, which has no
    // model credential and nothing to execute.
    const { POST } = await import("../app/api/submissions/route.ts");
    const problemId = await problemBySlug("count-the-failures");
    await markSolved(problemId);

    const response = await POST(new Request("http://local/api/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ problemId, kind: "defence", body: "Because a soft error lies." }),
    }));
    expect(response.status).toBe(202);

    const { id } = (await response.json()) as { id: number };
    const { rows } = await db().query<{ kind: string }>(
      "select kind::text from submission where id = $1", [id]);
    expect(rows[0]!.kind).toBe("defence");
  });

  it("has finished dispatching by the time it answers", async () => {
    // The route nudges the dispatcher. While that nudge was fired and not
    // awaited, it outlived the request, and the next test's resetDatabase
    // truncate deadlocked against it on outbox:
    //
    //   Process 116: truncate outbox, queue_message, ... restart identity cascade
    //   Process 108: update outbox set sent_at = now() where id = $1
    //
    // Only the dispatcher sets sent_at, so a row still unsent here means a
    // transaction is running that nobody holds a handle to.
    const { POST } = await import("../app/api/submissions/route.ts");
    const problemId = await problemBySlug("echo-the-question");

    const response = await POST(new Request("http://local/api/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ problemId, kind: "run", body: "def run_agent(q, llm, tools): return q" }),
    }));
    expect(response.status).toBe(202);

    const { rows } = await db().query<{ sent_at: Date | null }>(
      "select sent_at from outbox order by id desc limit 1");
    expect(rows[0]!.sent_at).not.toBeNull();
  });

  it("falls back to a run for a kind it does not know", async () => {
    const { POST } = await import("../app/api/submissions/route.ts");
    const problemId = await problemBySlug("echo-the-question");

    const response = await POST(new Request("http://local/api/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ problemId, kind: "sudo_pass", body: "x" }),
    }));
    const { id } = (await response.json()) as { id: number };
    const { rows } = await db().query<{ kind: string }>(
      "select kind::text from submission where id = $1", [id]);
    expect(rows[0]!.kind).toBe("run");
  });
});
