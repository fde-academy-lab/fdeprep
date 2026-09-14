/**
 * The Phase 2 acceptance items from docs/06, plus the two guarantees in
 * docs/03 section 9 that the whole pipeline rests on: the outbox is atomic,
 * and a stale runner cannot overwrite a fresh result.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../lib/db/pool.ts";
import { createSubmission, RateLimitError } from "../lib/submissions/create.ts";
import { dispatchOnce } from "../lib/queue/dispatcher.ts";
import { receive, send } from "../lib/queue/shim.ts";
import { writeResult } from "../lib/queue/result-writer.ts";
import { listProblems } from "../lib/problems/catalogue.ts";
import { publicView } from "../lib/submissions/view.ts";
import { importFixtures, resetDatabase, seedLearner } from "./helpers.ts";

let learner: Awaited<ReturnType<typeof seedLearner>>;

beforeEach(async () => {
  await resetDatabase();
  learner = await seedLearner();
});

afterAll(async () => {
  await closeDb();
});

async function problemBySlug(slug: string) {
  const { rows } = await db().query(
    `select p.id, p.difficulty, v.id as version_id
       from problem p join problem_version v
         on v.problem_id = p.id and v.version = p.current_version
      where p.slug = $1`, [slug]);
  return rows[0] as { id: string; difficulty: string; version_id: string };
}

// Eight code fixtures from Phase 2, plus the two prompt fixtures and the
// design fixture Phase 4 needed.
const FIXTURE_COUNT = 11;

describe("acceptance 1: every fixture imports and appears in the catalogue", () => {
  it("imports every fixture and lists them", async () => {
    const imported = await importFixtures();
    expect(imported).toBe(FIXTURE_COUNT);

    const page = await listProblems({ enrolmentId: learner.enrolmentId });
    expect(page.total).toBe(FIXTURE_COUNT);
    expect(page.rows).toHaveLength(FIXTURE_COUNT);
    expect(new Set(page.rows.map((r) => r.slug)).size).toBe(FIXTURE_COUNT);
  });

  it("writes a problem_version carrying the source verbatim", async () => {
    await importFixtures();
    const { rows } = await db().query<{ source_yaml: string; version: number }>(
      `select v.source_yaml, v.version from problem_version v
         join problem p on p.id = v.problem_id where p.slug = 'echo-the-question'`);
    expect(rows[0]!.version).toBe(1);
    expect(rows[0]!.source_yaml).toContain("slug: echo-the-question");
  });

  it("stores the tests against the version, not the problem", async () => {
    await importFixtures();
    const { rows } = await db().query<{ count: string }>(
      `select count(*) from problem_test t join problem_version v on v.id = t.problem_version_id
         join problem p on p.id = v.problem_id where p.slug = 'survive-the-hostile-tool'`);
    expect(Number(rows[0]!.count)).toBe(5);
  });
});

describe("the outbox from docs/03 section 9.2", () => {
  it("writes the submission, the cap decrement and the outbox row in one transaction",
    async () => {
      await importFixtures();
      const problem = await problemBySlug("retry-once-then-degrade");
      const submission = await createSubmission({
        enrolmentId: learner.enrolmentId, cohortId: learner.cohortId,
        problemId: Number(problem.id), kind: "run", body: "def run_agent(q,l,t): return 'x'",
      });

      const counts = await db().query<{ submissions: string; outbox: string; counters: string }>(
        `select (select count(*) from submission where id = $1) as submissions,
                (select count(*) from outbox where submission_id = $1) as outbox,
                (select count(*) from rate_limit_counter
                  where enrolment_id = $2 and scope = 'run_hourly') as counters`,
        [submission.id, learner.enrolmentId]);
      expect(counts.rows[0]).toEqual({ submissions: "1", outbox: "1", counters: "1" });
    });

  it("leaves no submission behind when the cap is already spent", async () => {
    await importFixtures();
    const problem = await problemBySlug("retry-once-then-degrade");
    await db().query(
      `update rate_limit_policy set max_count = 1 where scope = 'run_hourly'`);

    await createSubmission({
      enrolmentId: learner.enrolmentId, cohortId: learner.cohortId,
      problemId: Number(problem.id), kind: "run", body: "a",
    });
    await expect(createSubmission({
      enrolmentId: learner.enrolmentId, cohortId: learner.cohortId,
      problemId: Number(problem.id), kind: "run", body: "b",
    })).rejects.toBeInstanceOf(RateLimitError);

    const { rows } = await db().query<{ count: string }>("select count(*) from submission");
    expect(Number(rows[0]!.count)).toBe(1);
  });

  it("never leaves a submission with no message, which would hang in queued forever",
    async () => {
      await importFixtures();
      const problem = await problemBySlug("echo-the-question");
      for (let i = 0; i < 5; i++) {
        await createSubmission({
          enrolmentId: learner.enrolmentId, cohortId: learner.cohortId,
          problemId: Number(problem.id), kind: "run", body: `attempt ${i}`,
        });
      }
      const { rows } = await db().query<{ orphans: string }>(
        `select count(*) as orphans from submission s
          where not exists (select 1 from outbox o where o.submission_id = s.id)`);
      expect(Number(rows[0]!.orphans)).toBe(0);
    });

  it("publishes to the queue only through the dispatcher", async () => {
    await importFixtures();
    const problem = await problemBySlug("echo-the-question");
    const submission = await createSubmission({
      enrolmentId: learner.enrolmentId, cohortId: learner.cohortId,
      problemId: Number(problem.id), kind: "run", body: "a",
    });

    expect(await receive("submissions", 1)).toHaveLength(0);
    const sent = await dispatchOnce();
    expect(sent).toBe(1);

    const messages = await receive("submissions", 1);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.body["submission_id"]).toBe(submission.id);
    expect(messages[0]!.body["fencing_token"]).toBeTruthy();
  });

  it("is idempotent, so a second dispatcher pass publishes nothing new", async () => {
    await importFixtures();
    const problem = await problemBySlug("echo-the-question");
    await createSubmission({
      enrolmentId: learner.enrolmentId, cohortId: learner.cohortId,
      problemId: Number(problem.id), kind: "run", body: "a",
    });
    expect(await dispatchOnce()).toBe(1);
    expect(await dispatchOnce()).toBe(0);
  });
});

describe("the lease and fencing token from docs/03 section 9.3", () => {
  async function queued() {
    await importFixtures();
    const problem = await problemBySlug("echo-the-question");
    const submission = await createSubmission({
      enrolmentId: learner.enrolmentId, cohortId: learner.cohortId,
      problemId: Number(problem.id), kind: "run", body: "a",
    });
    await dispatchOnce();
    const [message] = await receive("submissions", 1);
    return { submission, message: message! };
  }

  const RESULT = {
    verdict: "pass", score: 100,
    gates: { static: { status: "pass" }, public: { status: "pass", passed: 2, total: 2, cases: [] },
             hidden: { status: "pass", passed: 2, total: 2, cases: [] },
             adversarial: { status: "skipped", passed: 0, total: 0, cases: [] } },
    budget: { llm_calls: 2, tool_calls: 1, wall_ms: 5, max_llm_calls: 6, within_budget: true },
    runner: { image_tag: "test", duration_ms: 5 },
  };

  it("commits a terminal verdict when the token matches", async () => {
    const { submission, message } = await queued();
    const applied = await writeResult({
      submission_id: submission.id,
      lease_token: message.body["lease_token"] as string,
      fencing_token: Number(message.body["fencing_token"]),
      body_sha256: message.body["body_sha256"] as string,
      result: RESULT,
    });
    expect(applied).toBe(true);

    const { rows } = await db().query<{ verdict: string; status: string }>(
      "select verdict, status from submission where id = $1", [submission.id]);
    expect(rows[0]).toEqual({ verdict: "pass", status: "terminal" });
  });

  it("refuses a result carrying a stale fencing token", async () => {
    const { submission, message } = await queued();
    const applied = await writeResult({
      submission_id: submission.id,
      lease_token: message.body["lease_token"] as string,
      fencing_token: Number(message.body["fencing_token"]) - 1,
      body_sha256: message.body["body_sha256"] as string,
      result: { ...RESULT, verdict: "fail" },
    });
    expect(applied).toBe(false);

    const { rows } = await db().query<{ verdict: string | null }>(
      "select verdict from submission where id = $1", [submission.id]);
    expect(rows[0]!.verdict).toBeNull();
  });

  it("stops a late runner overwriting a result that already landed", async () => {
    const { submission, message } = await queued();
    const claim = {
      submission_id: submission.id,
      lease_token: message.body["lease_token"] as string,
      fencing_token: Number(message.body["fencing_token"]),
      body_sha256: message.body["body_sha256"] as string,
    };
    expect(await writeResult({ ...claim, result: RESULT })).toBe(true);
    expect(await writeResult({ ...claim, result: { ...RESULT, verdict: "fail" } })).toBe(false);

    const { rows } = await db().query<{ verdict: string }>(
      "select verdict from submission where id = $1", [submission.id]);
    expect(rows[0]!.verdict).toBe("pass");
  });

  it("refuses a result whose body hash does not match the submission", async () => {
    const { submission, message } = await queued();
    const applied = await writeResult({
      submission_id: submission.id,
      lease_token: message.body["lease_token"] as string,
      fencing_token: Number(message.body["fencing_token"]),
      body_sha256: "0".repeat(64),
      result: RESULT,
    });
    expect(applied).toBe(false);
  });

  it("an error verdict does not consume the allowance", async () => {
    const { submission, message } = await queued();
    const before = await db().query<{ count: number }>(
      `select count from rate_limit_counter where enrolment_id = $1 and scope = 'run_hourly'`,
      [learner.enrolmentId]);

    await writeResult({
      submission_id: submission.id,
      lease_token: message.body["lease_token"] as string,
      fencing_token: Number(message.body["fencing_token"]),
      body_sha256: message.body["body_sha256"] as string,
      result: { ...RESULT, verdict: "error" },
    });

    const after = await db().query<{ count: number }>(
      `select count from rate_limit_counter where enrolment_id = $1 and scope = 'run_hourly'`,
      [learner.enrolmentId]);
    expect(after.rows[0]!.count).toBe(before.rows[0]!.count - 1);
  });
});

describe("acceptance 4: the result survives the browser closing", () => {
  it("a submission completed while nobody watched is still readable afterwards", async () => {
    await importFixtures();
    const problem = await problemBySlug("echo-the-question");
    const submission = await createSubmission({
      enrolmentId: learner.enrolmentId, cohortId: learner.cohortId,
      problemId: Number(problem.id), kind: "run", body: "a",
    });
    await dispatchOnce();
    const [message] = await receive("submissions", 1);

    // Nobody is listening at this point, which is the whole test.
    await writeResult({
      submission_id: submission.id,
      lease_token: message!.body["lease_token"] as string,
      fencing_token: Number(message!.body["fencing_token"]),
      body_sha256: message!.body["body_sha256"] as string,
      result: {
        verdict: "fail", score: 30,
        gates: {
          static: { status: "pass" },
          public: { status: "fail", passed: 1, total: 2,
                    cases: [{ name: "public_one", status: "pass", message: null },
                            { name: "public_two", status: "fail", message: "returns_nonempty: returned an empty string" }] },
          hidden: { status: "skipped", passed: 0, total: 2, cases: [] },
          adversarial: { status: "skipped", passed: 0, total: 0, cases: [] },
        },
        budget: { llm_calls: 1, tool_calls: 0, wall_ms: 3, max_llm_calls: 6, within_budget: true },
        runner: { image_tag: "test", duration_ms: 9 },
      },
    });

    const view = await publicView(submission.id);
    expect(view.status).toBe("terminal");
    expect(view.verdict).toBe("fail");
    expect(view.gates.public.cases).toHaveLength(2);
  });
});

describe("acceptance 5: the output pane shows public cases and nothing for hidden", () => {
  it("names public cases and withholds hidden ones", async () => {
    await importFixtures();
    const problem = await problemBySlug("echo-the-question");
    const submission = await createSubmission({
      enrolmentId: learner.enrolmentId, cohortId: learner.cohortId,
      problemId: Number(problem.id), kind: "submit", body: "a",
    });
    await dispatchOnce();
    const [message] = await receive("submissions", 1);
    await writeResult({
      submission_id: submission.id,
      lease_token: message!.body["lease_token"] as string,
      fencing_token: Number(message!.body["fencing_token"]),
      body_sha256: message!.body["body_sha256"] as string,
      result: {
        verdict: "fail", score: 30,
        gates: {
          static: { status: "pass" },
          public: { status: "pass", passed: 2, total: 2,
                    cases: [{ name: "public_one", status: "pass", message: null },
                            { name: "public_two", status: "pass", message: null }] },
          hidden: { status: "fail", passed: 1, total: 2,
                    cases: [{ name: "hidden_one", status: "pass", message: null },
                            { name: "hidden_two", status: "fail", message: "a secret" }] },
          adversarial: { status: "skipped", passed: 0, total: 0, cases: [] },
        },
        budget: { llm_calls: 1, tool_calls: 0, wall_ms: 3, max_llm_calls: 6, within_budget: true },
        runner: { image_tag: "test", duration_ms: 9 },
      },
    });

    const view = await publicView(submission.id);
    expect(view.gates.public.cases.map((c) => c.name)).toEqual(["public_one", "public_two"]);
    expect(view.gates.hidden.cases).toEqual([]);
    expect(view.gates.hidden.passed).toBe(1);
    expect(view.gates.hidden.total).toBe(2);
    expect(JSON.stringify(view)).not.toContain("hidden_two");
    expect(JSON.stringify(view)).not.toContain("a secret");
  });
});
