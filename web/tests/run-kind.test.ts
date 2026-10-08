/**
 * docs/00 section 4 and docs/01 S4: Run executes the public tests only, and
 * Submit runs public, hidden and adversarial under the per-tier caps.
 *
 * Found on 8 October 2026. createSubmission put the kind in the outbox
 * payload, the dispatcher carried it onto the queue, and the runner worker
 * built the runner's event without it, so the handler graded every Run with
 * the full battery and reported pass only when all three batteries passed. A
 * learner could ask whether the hidden battery passed thirty times an hour,
 * on a tier that allows one submit a day.
 *
 * Written before the fix. What these pin down, layer by layer: the worker
 * hands the runner the kind the submission was charged for; a Run of code
 * that passes public and fails hidden comes back as the public result and
 * nothing else, through the real runner; the writer never stores a hidden or
 * adversarial result on a Run, whatever a runner sends; the screens, the
 * hint gate and the coach read none from one; a Submit and a rehearsal submit
 * still run the full battery; and a defence still goes to the judge.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { closeDb, db } from "../lib/db/pool.ts";
import { createSubmission, type RunKind } from "../lib/submissions/create.ts";
import { dispatchOnce } from "../lib/queue/dispatcher.ts";
import { runOnce, writeResultsOnce } from "../lib/queue/runner-worker.ts";
import { writeResult } from "../lib/queue/result-writer.ts";
import { deleteMessage, depth, receive } from "../lib/queue/shim.ts";
import { publicView } from "../lib/submissions/view.ts";
import { attemptHistory } from "../lib/problems/workspace.ts";
import { publishImport } from "../lib/problems/import.ts";
import { validateProblemYaml } from "../lib/problems/validate.ts";
import { resolvePolicy } from "../lib/policy/index.ts";
import { loadTrace } from "../lib/trace/store.ts";
import { replayFor } from "../lib/trace/replay.ts";
import { importFixtures, resetDatabase, seedLearner } from "./helpers.ts";

const PROBLEMS = path.join(import.meta.dirname, "..", "..", "problems");
// Medium: hints open after one failed run and the hidden count is shown. Its
// naive solution passes both public cases and fails a hidden one.
const WORKED = "harness/recover-from-soft-tool-errors";
const NOTHING = { status: "skipped", passed: 0, total: 0, cases: [] };

let learner: Awaited<ReturnType<typeof seedLearner>>;

beforeEach(async () => {
  await resetDatabase();
  learner = await seedLearner();
});

afterAll(async () => {
  await closeDb();
});

async function publish(relative: string): Promise<{ id: number; source: string }> {
  const source = await readFile(path.join(PROBLEMS, `${relative}.yaml`), "utf8");
  const report = validateProblemYaml(source, relative);
  if (!report.problem) throw new Error(JSON.stringify(report.errors));
  return { id: (await publishImport(report.problem, source, { publish: true })).problemId, source };
}

const naive = (relative: string) =>
  readFile(path.join(PROBLEMS, relative, "naive_solution.py"), "utf8");

interface Case { name: string; visibility: string; spec: { input?: { question?: string } } }

/** The worked problem's unpublished cases: their names and the questions they ask. */
function unpublished(source: string): string[] {
  const tests = (parse(source) as { tests: Case[] }).tests;
  return tests.filter((t) => t.visibility !== "public")
    .flatMap((t) => [t.name, t.spec.input?.question ?? ""]).filter(Boolean);
}

function publicNames(source: string): string[] {
  return (parse(source) as { tests: Case[] }).tests
    .filter((t) => t.visibility === "public").map((t) => t.name);
}

async function create(problemId: number, kind: RunKind, body: string, rehearsalId?: number) {
  return createSubmission({
    enrolmentId: learner.enrolmentId, cohortId: learner.cohortId, problemId, kind, body,
    rehearsalId,
  });
}

/** Turn the whole crank once, through the real runner on this machine. */
async function drain(): Promise<void> {
  await dispatchOnce();
  await runOnce();
  await writeResultsOnce();
}

async function sitting(problemId: number): Promise<number> {
  const { rows } = await db().query<{ id: string }>(
    `insert into rehearsal (enrolment_id, ends_at, problem_ids)
     values ($1, now() + interval '1 hour', array[$2::bigint]) returning id`,
    [learner.enrolmentId, problemId]);
  return Number(rows[0]!.id);
}

/** Claim the dispatched message for one submission and write a scripted result. */
async function grade(submissionId: number, result: Record<string, unknown>): Promise<boolean> {
  await dispatchOnce();
  const message = (await receive("submissions", 10))
    .find((m) => Number(m.body["submission_id"]) === submissionId)!;
  const committed = await writeResult({
    submission_id: submissionId,
    lease_token: String(message.body["lease_token"]),
    fencing_token: Number(message.body["fencing_token"]),
    body_sha256: String(message.body["body_sha256"]),
    result,
  });
  await deleteMessage(message.id);
  return committed;
}

describe("the worker hands the runner the kind", () => {
  for (const kind of ["run", "submit", "rehearsal_submit"] as const) {
    it(`sends ${kind} for a ${kind}`, async () => {
      const { id } = await publish(WORKED);
      const rehearsalId = kind === "rehearsal_submit" ? await sitting(id) : undefined;
      const created = await create(id, kind, await naive(WORKED), rehearsalId);
      await dispatchOnce();

      const events: Array<Record<string, unknown>> = [];
      await runOnce({
        functionName: "fdeprep-runner",
        lambda: async (_fn, event) => {
          events.push(event);
          return { verdict: "error", message: "recorded", consumes_allowance: false };
        },
      });

      expect(events).toHaveLength(1);
      expect(events[0]!["submission_id"]).toBe(created.id);
      expect(events[0]!["kind"]).toBe(kind);
    });
  }
});

describe("a Run through the real runner", () => {
  it("reports the public result of code that fails hidden, and nothing about hidden", async () => {
    const { id, source } = await publish(WORKED);
    const run = await create(id, "run", await naive(WORKED));
    await drain();

    const view = await publicView(run.id);
    expect(view.kind).toBe("run");
    expect(view.verdict).toBe("pass");
    expect(view.score).toBeNull();
    expect(view.gates.public.status).toBe("pass");
    expect(view.gates.public.cases.map((c) => c.name).sort()).toEqual(publicNames(source).sort());
    expect(view.gates.hidden).toEqual(NOTHING);
    expect(view.gates.adversarial).toEqual(NOTHING);
    expect(view.steps).toHaveLength(4);

    const { rows: [row] } = await db().query<Record<string, unknown>>(
      `select verdict::text, score, hidden_passed, hidden_total, adv_passed, adv_total, result
         from submission where id = $1`, [run.id]);
    expect(row).toMatchObject({
      verdict: "pass", score: null,
      hidden_passed: null, hidden_total: null, adv_passed: null, adv_total: null,
    });

    // Nothing about an unpublished case anywhere a learner's request can
    // reach: the stored contract, the stored trace and the replay.
    const trace = await loadTrace(run.id);
    const replay = await replayFor(run.id);
    const reachable = JSON.stringify([row!["result"], view, trace, replay]);
    for (const secret of unpublished(source)) expect(reachable).not.toContain(secret);
    expect(new Set(replay.steps.map((s) => s.caseName))).toEqual(new Set(publicNames(source)));
  }, 120_000);

  it("leaves the hint gate shut, and the same code submitted fails and opens it", async () => {
    const { id } = await publish(WORKED);
    const body = await naive(WORKED);

    await create(id, "run", body);
    await drain();
    const afterRun = await resolvePolicy({ enrolmentId: learner.enrolmentId, problemId: id });
    expect(afterRun.state.failedRuns).toBe(0);
    expect(afterRun.hints.allowed).toBe(false);

    const submit = await create(id, "submit", `${body}\n`);
    await drain();
    const view = await publicView(submit.id);
    expect(view.verdict).toBe("fail");
    expect(view.gates.hidden.status).toBe("fail");
    expect(view.gates.hidden.total).toBeGreaterThan(view.gates.hidden.passed);
    expect(view.gates.hidden.cases).toEqual([]);
    expect(view.score).not.toBeNull();

    const afterSubmit = await resolvePolicy({ enrolmentId: learner.enrolmentId, problemId: id });
    expect(afterSubmit.state.failedRuns).toBe(1);
    expect(afterSubmit.hints.allowed).toBe(true);
  }, 120_000);

  it("still runs the full battery for a rehearsal submit", async () => {
    const { id } = await publish(WORKED);
    const submit = await create(id, "rehearsal_submit", await naive(WORKED), await sitting(id));
    await drain();

    const view = await publicView(submit.id);
    expect(view.verdict).toBe("fail");
    expect(view.gates.hidden.status).toBe("fail");
    expect(view.gates.hidden.total).toBeGreaterThan(0);
  }, 120_000);
});

describe("the writer keeps a Run to the public result, whatever a runner sends", () => {
  const PUBLIC_PASS = { status: "pass", passed: 2, total: 2,
                        cases: [{ name: "public_one", status: "pass", message: null },
                                { name: "public_two", status: "pass", message: null }] };
  const BUDGET = { llm_calls: 3, tool_calls: 2, wall_ms: 40, max_llm_calls: 3, within_budget: true };

  it("refuses a Run result in which a hidden case ran, and gives the unit back", async () => {
    // What a runner image older than the kind sends for a Run: the full
    // battery, its verdict and its trace.
    const { id } = await publish(WORKED);
    const run = await create(id, "run", "def run_agent(q, llm, tools): return q");
    expect(await grade(run.id, {
      verdict: "fail", score: 51.25,
      gates: {
        static: { status: "pass", reasons: [] },
        public: PUBLIC_PASS,
        hidden: { status: "fail", passed: 3, total: 4,
                  cases: [{ name: "secret_hidden_case", status: "fail", message: "a secret message" }] },
        adversarial: { status: "skipped", passed: 0, total: 1, cases: [] },
      },
      steps: [], budget: BUDGET,
      trace: { cases: [{ name: "secret_hidden_case",
                         trace: { steps: [{ seq: 1, type: "final", value: "Where is order 9?" }] } }] },
      runner: { image_tag: "runner:old", duration_ms: 900 },
    })).toBe(true);

    const view = await publicView(run.id);
    expect(view.verdict).toBe("error");
    expect(view.gates.hidden).toEqual(NOTHING);
    expect(view.message).toMatch(/not counted/);

    const { rows: [row] } = await db().query<{ result: unknown; score: unknown }>(
      "select result, score from submission where id = $1", [run.id]);
    const stored = JSON.stringify(row);
    for (const secret of ["secret_hidden_case", "a secret message", "Where is order 9?", "51.25"]) {
      expect(stored).not.toContain(secret);
    }
    expect(await loadTrace(run.id)).toBeNull();

    const { rows: counters } = await db().query<{ count: number }>(
      "select count from rate_limit_counter where enrolment_id = $1 and scope = 'run_hourly'",
      [learner.enrolmentId]);
    expect(counters.map((c) => c.count)).toEqual([0]);

    const { rows: events } = await db().query<{ level: string; message: string }>(
      "select level, message from runner_event where submission_id = $1 and level = 'error'",
      [run.id]);
    expect(events).toHaveLength(1);
  });

  it("drops the hidden count and the score from a Run whose public cases failed", async () => {
    const { id } = await publish(WORKED);
    const run = await create(id, "run", "def run_agent(q, llm, tools): return q");
    await grade(run.id, {
      verdict: "fail", score: 15,
      gates: {
        static: { status: "pass", reasons: [] },
        public: { status: "fail", passed: 1, total: 2,
                  cases: [{ name: "public_one", status: "pass", message: null },
                          { name: "public_two", status: "fail", message: "returns_nonempty: empty" }] },
        hidden: { status: "skipped", passed: 0, total: 4, cases: [] },
        adversarial: { status: "skipped", passed: 0, total: 1, cases: [] },
      },
      steps: [], budget: BUDGET,
      runner: { image_tag: "runner:old", duration_ms: 300 },
    });

    const view = await publicView(run.id);
    expect(view.verdict).toBe("fail");
    expect(view.score).toBeNull();
    expect(view.gates.public.passed).toBe(1);
    expect(view.gates.hidden).toEqual(NOTHING);
    expect(view.gates.adversarial).toEqual(NOTHING);
    const { rows: [row] } = await db().query<Record<string, unknown>>(
      "select score, hidden_total, adv_total from submission where id = $1", [run.id]);
    expect(row).toEqual({ score: null, hidden_total: null, adv_total: null });
  });
});

describe("what a learner reads back from a Run written before the fix", () => {
  /** A Run row as the old path left it: the whole battery's counts, a score and, once passed, names. */
  async function oldRun(problemId: number): Promise<number> {
    const { rows: [attempt] } = await db().query<{ id: string }>(
      `insert into attempt (enrolment_id, problem_id, cohort_id, solved_at) values ($1, $2, $3, now())
       returning id`, [learner.enrolmentId, problemId, learner.cohortId]);
    const result = {
      verdict: "fail", score: 51.25,
      gates: {
        static: { status: "pass" },
        public: { status: "pass", passed: 2, total: 2, cases: [] },
        hidden: { status: "fail", passed: 3, total: 4,
                  cases: [{ name: "secret_hidden_case", status: "fail", message: "a secret message" }] },
        adversarial: { status: "skipped", passed: 0, total: 1, cases: [] },
      },
    };
    const { rows: [row] } = await db().query<{ id: string }>(
      `insert into submission (attempt_id, problem_version_id, kind, body, body_sha256, status,
                               verdict, score, public_passed, public_total, hidden_passed,
                               hidden_total, adv_passed, adv_total, result, finished_at)
       select $1, v.id, 'run', 'x', 'old', 'terminal', 'fail', 51.25, 2, 2, 3, 4, 0, 1, $3, now()
         from problem p join problem_version v on v.problem_id = p.id and v.version = p.current_version
        where p.id = $2 returning id`,
      [attempt!.id, problemId, JSON.stringify(result)]);
    return Number(row!.id);
  }

  it("shows the public gate alone, even once the problem is passed", async () => {
    const { id } = await publish(WORKED);
    const view = await publicView(await oldRun(id));
    expect(view.gates.hidden).toEqual(NOTHING);
    expect(view.gates.adversarial).toEqual(NOTHING);
    expect(view.score).toBeNull();
    expect(JSON.stringify(view)).not.toContain("secret_hidden_case");
  });

  it("lists it in the Attempts tab with no hidden count and no score", async () => {
    const { id } = await publish(WORKED);
    await oldRun(id);
    const [past] = (await attemptHistory(learner.enrolmentId, id)).submissions;
    expect(past).toMatchObject({ kind: "run", publicPassed: 2, publicTotal: 2,
                                 hiddenPassed: null, hiddenTotal: null, score: null });
  });
});

describe("a defence", () => {
  it("still goes to the judge with its own kind and never reaches the runner", async () => {
    await importFixtures();
    const { rows: [problem] } = await db().query<{ id: string }>(
      "select id from problem where slug = 'count-the-failures'");
    await db().query(
      `insert into attempt (enrolment_id, problem_id, cohort_id, solved_at) values ($1, $2, $3, now())`,
      [learner.enrolmentId, problem!.id, learner.cohortId]);
    await create(Number(problem!.id), "defence", "The loop counts each failure once and stops.");
    await dispatchOnce();

    expect(await depth("submissions")).toBe(0);
    const [message] = await receive("judgements", 1);
    expect(message!.body).toMatchObject({ kind: "defence", artefact_type: "defence" });
  });
});
