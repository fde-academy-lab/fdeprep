/**
 * Phase 6 acceptance 4: every admin action writes an audit row with an actor.
 *
 * docs/02 section 9: log every persona change, cap override, problem publish
 * and roster edit. The audit trail is the point, so the test that matters is
 * the one asserting nothing slips through unlogged.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../lib/db/pool.ts";
import {
  applyPersonaCsv, clearCounter, parsePersonaCsv, requeueSubmission, roster, toggleDegradedMode,
} from "../lib/admin/index.ts";
import { opsSnapshot, STUCK_VOICE_AFTER_MINUTES } from "../lib/admin/ops.ts";
import { browseSubmissions } from "../lib/admin/submissions.ts";
import { createSubmission } from "../lib/submissions/create.ts";
import { dispatchOnce } from "../lib/queue/dispatcher.ts";
import { seedTracks } from "../lib/policy/roadmap.ts";
import { depth } from "../lib/queue/shim.ts";
import { startRehearsal } from "../lib/rehearsal/index.ts";
import { fixtureQuestionId } from "../lib/voice/fixture.ts";
import { MAX_JUDGE_ATTEMPTS } from "../lib/voice/score.ts";
import { submitTypedAnswer } from "../lib/voice/typed.ts";
import { importFixtures, resetDatabase, seedLearner } from "./helpers.ts";

let learner: Awaited<ReturnType<typeof seedLearner>>;
let admin: Awaited<ReturnType<typeof seedLearner>>;

beforeEach(async () => {
  await resetDatabase();
  await importFixtures();
  await seedTracks();
  learner = await seedLearner({ persona: "navigator", githubId: 11, login: "alice" });
  admin = await seedLearner({
    persona: "accelerator", githubId: 12, login: "admin", cohortId: learner.cohortId,
  });
  await db().query("update enrolment set role = 'admin' where id = $1", [admin.enrolmentId]);
});

afterAll(async () => {
  await closeDb();
});

async function auditRows(action?: string) {
  const { rows } = await db().query<{
    action: string; target: string; actor_id: string | null; detail: Record<string, unknown>;
  }>(
    `select action, target, actor_id, detail from audit_log
      ${action ? "where action = $1" : ""} order by id`, action ? [action] : []);
  return rows;
}

describe("acceptance 4: every admin action writes an audit row with an actor", () => {
  it("logs a persona change", async () => {
    await applyPersonaCsv(
      [{ login: "alice", persona: "builder" }], { actorId: admin.userId, cohortId: learner.cohortId });

    const rows = await auditRows("persona.change");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actor_id).toBe(String(admin.userId));
    expect(rows[0]!.target).toBe("alice");
    expect(rows[0]!.detail).toMatchObject({ from: "navigator", to: "builder" });
  });

  it("logs a degraded mode toggle with the reason", async () => {
    await toggleDegradedMode(true, "Runner rollback in progress.", admin.userId);
    const rows = await auditRows("platform.degraded_mode");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actor_id).toBe(String(admin.userId));
    expect(rows[0]!.detail).toMatchObject({ on: true, reason: "Runner rollback in progress." });
  });

  it("logs a requeue", async () => {
    const submission = await stuckSubmission();
    await requeueSubmission(submission.id, "Message lost, queue empty.", admin.userId);

    const rows = await auditRows("submission.requeue");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actor_id).toBe(String(admin.userId));
    expect(rows[0]!.target).toBe(String(submission.id));
  });

  it("logs a counter clear with the reason", async () => {
    await spendSubmitAllowance();
    await clearCounter(
      { enrolmentId: learner.enrolmentId, scope: "submit_daily" },
      "Lost an Extreme attempt to a runner fault.", admin.userId);

    const rows = await auditRows("cap.clear");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actor_id).toBe(String(admin.userId));
    expect(rows[0]!.detail).toMatchObject({ reason: "Lost an Extreme attempt to a runner fault." });
  });

  it("never writes an audit row without an actor", async () => {
    await toggleDegradedMode(true, "One.", admin.userId);
    await toggleDegradedMode(false, null, admin.userId);
    const submission = await stuckSubmission();
    await requeueSubmission(submission.id, "Two.", admin.userId);

    const rows = await auditRows();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.actor_id).not.toBeNull();
  });
});

describe("the reason is mandatory where it is the whole point", () => {
  it("refuses a counter clear with no reason", async () => {
    await spendSubmitAllowance();
    await expect(clearCounter(
      { enrolmentId: learner.enrolmentId, scope: "submit_daily" }, "  ", admin.userId))
      .rejects.toThrow(/reason/i);
  });

  it("refuses a requeue with no reason", async () => {
    const submission = await stuckSubmission();
    await expect(requeueSubmission(submission.id, "", admin.userId)).rejects.toThrow(/reason/i);
  });

  it("writes nothing when it refuses", async () => {
    await spendSubmitAllowance();
    await clearCounter({ enrolmentId: learner.enrolmentId, scope: "submit_daily" }, "", admin.userId)
      .catch(() => {});
    expect(await auditRows()).toHaveLength(0);
  });
});

describe("the requeue action from the docs/05 runbook", () => {
  it("puts a fresh message on the queue", async () => {
    const submission = await stuckSubmission();
    expect(await depth("submissions")).toBe(0);

    await requeueSubmission(submission.id, "Message lost, queue empty.", admin.userId);
    expect(await depth("submissions")).toBe(1);
  });

  it("does not consume the learner's cap", async () => {
    const submission = await stuckSubmission();
    const before = await counterCount();
    await requeueSubmission(submission.id, "Message lost, queue empty.", admin.userId);
    expect(await counterCount()).toBe(before);
  });

  it("refuses a submission that already reached a verdict", async () => {
    const submission = await stuckSubmission();
    await db().query(
      "update submission set verdict = 'pass', status = 'terminal' where id = $1",
      [submission.id]);
    await expect(requeueSubmission(submission.id, "Looks stuck.", admin.userId))
      .rejects.toThrow(/already/i);
  });
});

describe("the counter clear from the docs/05 runbook", () => {
  it("removes the row so the learner gets the attempt back", async () => {
    await spendSubmitAllowance();
    expect(await counterCount()).toBeGreaterThan(0);

    await clearCounter(
      { enrolmentId: learner.enrolmentId, scope: "submit_daily" },
      "Lost an Extreme attempt to a runner fault.", admin.userId);
    expect(await counterCount()).toBe(0);
  });
});

describe("the roster and the CSV upload", () => {
  it("lists the cohort with persona and state", async () => {
    const rows = await roster(learner.cohortId);
    expect(rows.map((r) => r.login).sort()).toEqual(["admin", "alice"]);
    expect(rows.find((r) => r.login === "alice")!.persona).toBe("navigator");
  });

  it("reads a CSV with a header in any column order", () => {
    const parsed = parsePersonaCsv("persona,login\nbuilder,alice\naccelerator,admin\n");
    expect(parsed.rows).toEqual([
      { login: "alice", persona: "builder" },
      { login: "admin", persona: "accelerator" },
    ]);
    expect(parsed.errors).toEqual([]);
  });

  it("reports an unknown persona by line rather than failing the whole file", () => {
    const parsed = parsePersonaCsv("login,persona\nalice,builder\nadmin,wizard\n");
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.errors[0]).toContain("line 3");
    expect(parsed.errors[0]).toContain("wizard");
  });

  it("reports a login that is not in the cohort rather than creating one", async () => {
    const result = await applyPersonaCsv(
      [{ login: "nobody", persona: "builder" }],
      { actorId: admin.userId, cohortId: learner.cohortId });
    expect(result.changed).toBe(0);
    expect(result.errors[0]).toContain("nobody");
    expect(await auditRows("persona.change")).toHaveLength(0);
  });

  it("skips a row that would change nothing, so the audit stays readable", async () => {
    const result = await applyPersonaCsv(
      [{ login: "alice", persona: "navigator" }],
      { actorId: admin.userId, cohortId: learner.cohortId });
    expect(result.changed).toBe(0);
    expect(result.unchanged).toBe(1);
    expect(await auditRows("persona.change")).toHaveLength(0);
  });
});

describe("the submissions browser", () => {
  it("filters by verdict", async () => {
    const one = await stuckSubmission();
    await db().query("update submission set verdict = 'pass', status = 'terminal' where id = $1",
      [one.id]);
    await stuckSubmission("bound-the-agent-loop");

    const passed = await browseSubmissions({ verdict: "pass" });
    expect(passed.rows).toHaveLength(1);
    expect(passed.rows[0]!.verdict).toBe("pass");
  });

  it("filters by learner", async () => {
    await stuckSubmission();
    const page = await browseSubmissions({ login: "alice" });
    expect(page.rows.length).toBeGreaterThan(0);
    for (const row of page.rows) expect(row.login).toBe("alice");
  });

  it("carries a trace link only where a trace exists", async () => {
    const submission = await stuckSubmission();
    const page = await browseSubmissions({});
    expect(page.rows.find((r) => r.id === submission.id)!.hasTrace).toBe(false);
  });
});

describe("the ops dashboard", () => {
  it("reports queue depth, the runner error rate and the stuck list", async () => {
    await stuckSubmission();
    const snapshot = await opsSnapshot();

    expect(snapshot.queueDepth).toBeGreaterThanOrEqual(0);
    expect(snapshot.errorRate).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(snapshot.stuck)).toBe(true);
    expect(snapshot.degraded.on).toBe(false);
  });

  it("counts a submission queued past the threshold as stuck", async () => {
    const submission = await stuckSubmission();
    await db().query(
      "update submission set queued_at = now() - interval '10 minutes' where id = $1",
      [submission.id]);
    const snapshot = await opsSnapshot();
    expect(snapshot.stuck.map((row) => row.id)).toContain(submission.id);
  });

  it("does not call a fresh submission stuck", async () => {
    const submission = await stuckSubmission();
    const snapshot = await opsSnapshot();
    expect(snapshot.stuck.map((row) => row.id)).not.toContain(submission.id);
  });
});

describe("last activity counts every kind of practice", () => {
  // Found by the seed: a learner with forty voice answers and no submission
  // read "never" on the roster, because last activity read submissions alone.
  it("reads a voice answer from a learner who never submitted anything", async () => {
    const session = await submitTypedAnswer({
      enrolmentId: learner.enrolmentId, cohortId: learner.cohortId,
      voiceQuestionId: await fixtureQuestionId(), mode: "guided",
      text: "The loop counts its steps and stops at the ceiling, then hands over what it found.",
    });
    const { rows } = await db().query<{ started_at: Date }>(
      "select started_at from voice_session where id = $1", [session]);

    const row = (await roster(learner.cohortId)).find((r) => r.login === "alice")!;
    expect(row.lastActivity).toBe(rows[0]!.started_at.toISOString());
  });

  it("reads a rehearsal sat after the last submission", async () => {
    await stuckSubmission();
    await db().query("update submission set queued_at = now() - interval '2 days'");
    const sitting = await startRehearsal(learner.enrolmentId);

    const row = (await roster(learner.cohortId)).find((r) => r.login === "alice")!;
    expect(row.lastActivity).toBe(sitting.startedAt.toISOString());
  });

  it("still reads never for somebody who has done nothing", async () => {
    const row = (await roster(learner.cohortId)).find((r) => r.login === "admin")!;
    expect(row.lastActivity).toBeNull();
  });
});

describe("the ops dashboard lists voice answers nobody scored", () => {
  // Found by the seed: 34 answers sat on "Scoring" for a week and Ops said
  // nothing was stuck, because the stuck list read submissions alone.
  async function finished(minutesAgo: number, attempts: number, scored = false): Promise<number> {
    const { rows } = await db().query<{ id: string }>(
      `insert into voice_session
         (enrolment_id, voice_question_id, cohort_id, mode, input, started_at, finished_at,
          transcript, judge_attempts, scored_at)
       values ($1, $2, $3, 'guided', 'typed', now() - make_interval(mins => $4 + 3),
               now() - make_interval(mins => $4), 'an answer', $5,
               case when $6 then now() end)
       returning id`,
      [learner.enrolmentId, await fixtureQuestionId(), learner.cohortId, minutesAgo, attempts, scored]);
    return Number(rows[0]!.id);
  }

  it("names the two reasons an answer waits, and leaves out the ones still on time", async () => {
    const notRunning = await finished(STUCK_VOICE_AFTER_MINUTES + 60, 0);
    const gaveUp = await finished(180, MAX_JUDGE_ATTEMPTS);
    await finished(10, 0);                       // inside the hour: the scorer may yet get to it
    await finished(300, 1, true);                // scored, so not waiting on anything

    const { stuckVoice } = await opsSnapshot();

    // Oldest first, like the stuck submissions above it.
    expect(stuckVoice.map((row) => [row.id, row.why])).toEqual([
      [gaveUp, "judge_gave_up"],
      [notRunning, "scorer_not_running"],
    ]);
    const row = stuckVoice.find((r) => r.id === notRunning)!;
    expect(row.login).toBe("alice");
    expect(row.questionTitle).toBe("Explain how you guarantee an agent loop terminates");
    expect(row.waitingMinutes).toBe(STUCK_VOICE_AFTER_MINUTES + 60);
  });

  it("lists an answer the judge gave up on whenever it finished", async () => {
    const gaveUp = await finished(5, MAX_JUDGE_ATTEMPTS);
    expect((await opsSnapshot()).stuckVoice.map((row) => row.id)).toEqual([gaveUp]);
  });

  it("is empty when every answer is scored or still inside the hour", async () => {
    await finished(10, 0);
    await finished(600, 2, true);
    expect((await opsSnapshot()).stuckVoice).toEqual([]);
  });
});

async function stuckSubmission(slug = "echo-the-question") {
  const { rows } = await db().query<{ id: string }>(
    "select id from problem where slug = $1", [slug]);
  return createSubmission({
    enrolmentId: learner.enrolmentId, cohortId: learner.cohortId,
    problemId: Number(rows[0]!.id), kind: "run",
    body: `def run_agent(q, llm, tools): return q  # ${slug}`,
  });
}

async function spendSubmitAllowance() {
  const { rows } = await db().query<{ id: string }>(
    "select id from problem where slug = 'echo-the-question'");
  await createSubmission({
    enrolmentId: learner.enrolmentId, cohortId: learner.cohortId,
    problemId: Number(rows[0]!.id), kind: "submit",
    body: "def run_agent(q, llm, tools): return q",
  });
}

async function counterCount(): Promise<number> {
  const { rows } = await db().query<{ count: string }>(
    "select count(*) from rate_limit_counter where enrolment_id = $1 and scope = 'submit_daily'",
    [learner.enrolmentId]);
  return Number(rows[0]!.count);
}
