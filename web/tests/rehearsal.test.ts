/**
 * Phase 6 acceptance 1, 2 and 3: the rehearsal report, the weekly cap, and
 * degraded mode.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../lib/db/pool.ts";
import { finishRehearsal, reportFor, startRehearsal } from "../lib/rehearsal/index.ts";
import { createSubmission, RateLimitError } from "../lib/submissions/create.ts";
import { resolvePolicy, setDegradedMode } from "../lib/policy/index.ts";
import { seedTracks } from "../lib/policy/roadmap.ts";
import { importFixtures, resetDatabase, seedLearner } from "./helpers.ts";

let learner: Awaited<ReturnType<typeof seedLearner>>;

beforeEach(async () => {
  await resetDatabase();
  await importFixtures();
  await seedTracks();
  learner = await seedLearner({ persona: "navigator" });
});

afterAll(async () => {
  await closeDb();
});

describe("starting a rehearsal", () => {
  it("draws problems matching the persona", async () => {
    const session = await startRehearsal(learner.enrolmentId);
    expect(session.problems.length).toBeGreaterThan(0);
    expect(session.endsAt.getTime()).toBeGreaterThan(session.startedAt.getTime());
  });

  it("gives two personas different sequences over the same catalogue", async () => {
    const other = await seedLearner({
      persona: "accelerator", githubId: 77, cohortId: learner.cohortId,
    });
    const mine = await startRehearsal(learner.enrolmentId);
    const theirs = await startRehearsal(other.enrolmentId);
    expect(mine.problems.map((p) => p.slug)).not.toEqual(theirs.problems.map((p) => p.slug));
  });

  it("fixes the sequence so the learner cannot reorder it", async () => {
    const session = await startRehearsal(learner.enrolmentId);
    const reread = await reportFor(session.id);
    expect(reread.problems.map((p) => p.problemId))
      .toEqual(session.problems.map((p) => p.problemId));
  });
});

describe("acceptance 2: the weekly rehearsal cap holds", () => {
  it("allows two and refuses the third", async () => {
    await startRehearsal(learner.enrolmentId);
    await startRehearsal(learner.enrolmentId);
    await expect(startRehearsal(learner.enrolmentId)).rejects.toBeInstanceOf(RateLimitError);
  });

  it("names the window in the refusal, so the learner knows when to come back", async () => {
    await startRehearsal(learner.enrolmentId);
    await startRehearsal(learner.enrolmentId);
    await expect(startRehearsal(learner.enrolmentId)).rejects.toThrow(/rehearsal/i);
  });
});

describe("Extreme rules apply regardless of native difficulty", () => {
  it("closes hints on an Easy problem inside a rehearsal", async () => {
    const problemId = await problemBySlug("echo-the-question");
    const ordinary = await resolvePolicy({ enrolmentId: learner.enrolmentId, problemId });
    const inRehearsal = await resolvePolicy({
      enrolmentId: learner.enrolmentId, problemId, rehearsal: true,
    });

    expect(ordinary.hints.total).toBeGreaterThan(0);
    expect(ordinary.layers.hints).toBe(true);
    expect(inRehearsal.layers.hints).toBe(false);
    expect(inRehearsal.hints.allowed).toBe(false);
  });

  it("hides the test names and the acceptance rate", async () => {
    const problemId = await problemBySlug("echo-the-question");
    const inRehearsal = await resolvePolicy({
      enrolmentId: learner.enrolmentId, problemId, rehearsal: true,
    });
    expect(inRehearsal.visibility.publicNames).toBe(false);
    expect(inRehearsal.visibility.acceptanceRate).toBe(false);
    expect(inRehearsal.visibility.hiddenCount).toBe(false);
  });

  it("strips the scaffold down to the brief", async () => {
    const problemId = await problemBySlug("echo-the-question");
    const inRehearsal = await resolvePolicy({
      enrolmentId: learner.enrolmentId, problemId, rehearsal: true,
    });
    expect(inRehearsal.layers.brief).toBe(true);
    expect(inRehearsal.layers.stub).toBe(false);
    expect(inRehearsal.layers.contract).toBe(false);
    expect(inRehearsal.rehearsal).toBe(true);
  });

  it("leaves the ordinary view of the same problem untouched", async () => {
    const problemId = await problemBySlug("echo-the-question");
    const ordinary = await resolvePolicy({ enrolmentId: learner.enrolmentId, problemId });
    expect(ordinary.rehearsal).toBe(false);
    expect(ordinary.layers.stub).toBe(true);
  });
});

describe("acceptance 1: the report", () => {
  it("carries a per-problem verdict and a total", async () => {
    const session = await startRehearsal(learner.enrolmentId);
    for (const [index, problem] of session.problems.entries()) {
      await recordVerdict(session.id, problem.problemId, index === 0 ? "pass" : "fail",
        index === 0 ? 80 : 20);
    }
    const report = await finishRehearsal(session.id);

    expect(report.problems).toHaveLength(session.problems.length);
    for (const row of report.problems) expect(row.verdict).not.toBeNull();
    expect(report.passed).toBe(1);
    expect(report.total).toBe(session.problems.length);
    expect(report.score).toBeGreaterThan(0);
  });

  it("totals the budget used across the sitting", async () => {
    const session = await startRehearsal(learner.enrolmentId);
    await recordVerdict(session.id, session.problems[0]!.problemId, "pass", 90, 4);
    await recordVerdict(session.id, session.problems[1]!.problemId, "fail", 0, 6);
    const report = await finishRehearsal(session.id);
    expect(report.llmCalls).toBe(10);
  });

  it("reports a problem never submitted as unattempted rather than failed", async () => {
    const session = await startRehearsal(learner.enrolmentId);
    await recordVerdict(session.id, session.problems[0]!.problemId, "pass", 70);
    const report = await finishRehearsal(session.id);

    const untouched = report.problems.filter((row) => row.verdict === null);
    expect(untouched.length).toBe(session.problems.length - 1);
    expect(report.passed).toBe(1);
  });

  it("is written once and read back the same", async () => {
    const session = await startRehearsal(learner.enrolmentId);
    await recordVerdict(session.id, session.problems[0]!.problemId, "pass", 70);
    const written = await finishRehearsal(session.id);
    const reread = await reportFor(session.id);
    expect(reread.score).toBe(written.score);
    expect(reread.finishedAt).not.toBeNull();
  });
});

describe("acceptance 3: degraded mode", () => {
  it("blocks Submit with a message that says what to do instead", async () => {
    await withAdmin((client, actorId) =>
      setDegradedMode(client, true, "The runner is being rolled back.", actorId));

    const problemId = await problemBySlug("echo-the-question");
    const policy = await resolvePolicy({ enrolmentId: learner.enrolmentId, problemId });

    expect(policy.submit.allowed).toBe(false);
    expect(policy.submit.reason).toContain("Run still works");
    expect(policy.submit.reason).toContain("The runner is being rolled back.");
  });

  it("leaves Run working", async () => {
    await withAdmin((client, actorId) =>
      setDegradedMode(client, true, "Queue is not draining.", actorId));

    const problemId = await problemBySlug("echo-the-question");
    const policy = await resolvePolicy({ enrolmentId: learner.enrolmentId, problemId });
    expect(policy.run.allowed).toBe(true);

    const submission = await createSubmission({
      enrolmentId: learner.enrolmentId, cohortId: learner.cohortId,
      problemId, kind: "run", body: "def run_agent(q, llm, tools): return q",
    });
    expect(submission.id).toBeGreaterThan(0);
  });

  it("refuses a submit on the server, not only in the button", async () => {
    await withAdmin((client, actorId) =>
      setDegradedMode(client, true, "Queue is not draining.", actorId));

    const problemId = await problemBySlug("echo-the-question");
    await expect(createSubmission({
      enrolmentId: learner.enrolmentId, cohortId: learner.cohortId,
      problemId, kind: "submit", body: "def run_agent(q, llm, tools): return q",
    })).rejects.toThrow(/Run still works/);
  });

  it("spends no allowance on the refused submit", async () => {
    await withAdmin((client, actorId) =>
      setDegradedMode(client, true, "Queue is not draining.", actorId));
    const problemId = await problemBySlug("echo-the-question");
    await createSubmission({
      enrolmentId: learner.enrolmentId, cohortId: learner.cohortId,
      problemId, kind: "submit", body: "x",
    }).catch(() => {});

    const { rows } = await db().query<{ count: number }>(
      "select count from rate_limit_counter where scope = 'submit_daily'");
    expect(rows).toHaveLength(0);
  });

  it("opens Submit again when the switch is cleared", async () => {
    await withAdmin((client, actorId) =>
      setDegradedMode(client, true, "Queue is not draining.", actorId));
    await withAdmin((client, actorId) => setDegradedMode(client, false, null, actorId));

    const problemId = await problemBySlug("echo-the-question");
    const policy = await resolvePolicy({ enrolmentId: learner.enrolmentId, problemId });
    expect(policy.submit.allowed).toBe(true);
  });

  it("refuses to turn on without a reason, since it shows on every screen", async () => {
    await expect(withAdmin((client, actorId) =>
      setDegradedMode(client, true, "   ", actorId))).rejects.toThrow(/reason/i);
  });
});

async function problemBySlug(slug: string): Promise<number> {
  const { rows } = await db().query<{ id: string }>(
    "select id from problem where slug = $1", [slug]);
  return Number(rows[0]!.id);
}

async function recordVerdict(
  rehearsalId: number, problemId: number, verdict: string, score: number, llmCalls = 0,
): Promise<void> {
  const { rows: a } = await db().query<{ id: string }>(
    `insert into attempt (enrolment_id, problem_id, cohort_id) values ($1, $2, $3)
     on conflict (enrolment_id, problem_id) do update set problem_id = excluded.problem_id
     returning id`,
    [learner.enrolmentId, problemId, learner.cohortId]);
  const { rows: v } = await db().query<{ id: string }>(
    "select id from problem_version where problem_id = $1 order by version desc limit 1",
    [problemId]);
  await db().query(
    `insert into submission (attempt_id, problem_version_id, kind, body, body_sha256, status,
                             verdict, score, llm_calls, rehearsal_id, finished_at)
     values ($1,$2,'rehearsal_submit','x',$3,'terminal',$4::verdict,$5,$6,$7,now())`,
    [a[0]!.id, v[0]!.id, `sha-${rehearsalId}-${problemId}`, verdict, score, llmCalls, rehearsalId]);
}

/** Run something as an admin, the way an admin action route would. */
async function withAdmin<T>(
  fn: (client: Parameters<typeof setDegradedMode>[0], actorId: number) => Promise<T>,
): Promise<T> {
  return fn(db(), learner.userId);
}

describe("a rehearsal submit cannot be claimed from outside a sitting", () => {
  it("refuses the kind when no rehearsal id comes with it", async () => {
    // rehearsal_submit spends no rolling-window allowance, so accepting the
    // client's word for it would be an uncapped submit.
    const problemId = await problemBySlug("echo-the-question");
    await expect(createSubmission({
      enrolmentId: learner.enrolmentId, cohortId: learner.cohortId,
      problemId, kind: "rehearsal_submit", body: "x",
    })).rejects.toThrow(/not running/i);
  });

  it("refuses a rehearsal id belonging to someone else", async () => {
    const other = await seedLearner({
      persona: "builder", githubId: 88, cohortId: learner.cohortId,
    });
    const theirs = await startRehearsal(other.enrolmentId);

    const problemId = await problemBySlug("echo-the-question");
    await expect(createSubmission({
      enrolmentId: learner.enrolmentId, cohortId: learner.cohortId,
      problemId, kind: "rehearsal_submit", body: "x", rehearsalId: theirs.id,
    })).rejects.toThrow(/not running/i);
  });

  it("refuses a sitting that has already finished", async () => {
    const session = await startRehearsal(learner.enrolmentId);
    await finishRehearsal(session.id);

    await expect(createSubmission({
      enrolmentId: learner.enrolmentId, cohortId: learner.cohortId,
      problemId: session.problems[0]!.problemId, kind: "rehearsal_submit", body: "x",
      rehearsalId: session.id,
    })).rejects.toThrow(/not running/i);
  });

  it("accepts one inside a live sitting and spends no submit allowance", async () => {
    const session = await startRehearsal(learner.enrolmentId);
    const created = await createSubmission({
      enrolmentId: learner.enrolmentId, cohortId: learner.cohortId,
      problemId: session.problems[0]!.problemId, kind: "rehearsal_submit",
      body: "def run_agent(q, llm, tools): return q", rehearsalId: session.id,
    });
    expect(created.id).toBeGreaterThan(0);

    const { rows } = await db().query(
      "select 1 from rate_limit_counter where scope = 'submit_daily'");
    expect(rows).toHaveLength(0);
  });

  it("allows only one submit per problem in a sitting", async () => {
    const session = await startRehearsal(learner.enrolmentId);
    const problemId = session.problems[0]!.problemId;
    const once = {
      enrolmentId: learner.enrolmentId, cohortId: learner.cohortId,
      problemId, kind: "rehearsal_submit" as const, rehearsalId: session.id,
    };
    await createSubmission({ ...once, body: "first" });
    await expect(createSubmission({ ...once, body: "second" }))
      .rejects.toThrow(/one submit per problem/i);
  });
});

describe("which Extreme rules a rehearsal borrows", () => {
  it("does not ask for a learner-written test first", async () => {
    // docs/00 section 7.4 lists the rules a rehearsal applies and this is not
    // one of them. Demanding a test per problem would spend the sitting on
    // scaffolding rather than on the problems.
    const problemId = await problemBySlug("echo-the-question");
    const inRehearsal = await resolvePolicy({
      enrolmentId: learner.enrolmentId, problemId, rehearsal: true,
    });
    expect(inRehearsal.learnerTests.required).toBe(false);
  });

  it("still asks for one on an Extreme problem outside a rehearsal", async () => {
    const problemId = await problemBySlug("survive-the-hostile-tool");
    const ordinary = await resolvePolicy({ enrolmentId: learner.enrolmentId, problemId });
    expect(ordinary.learnerTests.required).toBe(true);
  });

  it("still confirms before spending the submit", async () => {
    const problemId = await problemBySlug("echo-the-question");
    const inRehearsal = await resolvePolicy({
      enrolmentId: learner.enrolmentId, problemId, rehearsal: true,
    });
    expect(inRehearsal.confirmBeforeSubmit).toBe(true);
    expect(inRehearsal.timed).toBe(true);
  });
});
