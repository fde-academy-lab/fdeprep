/**
 * Regrading earlier submissions under a new judge prompt. S15.3, call C5.
 *
 * The judge is a fake here: a regrade's rules are about what it appends and
 * what it leaves alone, and none of them is a fact about a model. The real
 * judge's half, naming the prompt it graded with, is tests/test_judge_prompt.py.
 *
 * The rules under test: a regrade appends an evaluation and never edits or
 * deletes one, never moves a terminal verdict, never spends an allowance, and
 * leaves both rows naming the prompt that graded them, the newer one shown.
 */
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Learner } from "../lib/session/current.ts";

const session = vi.hoisted(() => ({ learner: null as Learner | null }));

vi.mock("../lib/session/current.ts", async (original) => ({
  ...(await original<typeof import("../lib/session/current.ts")>()),
  currentLearner: async () => {
    if (!session.learner) throw new Error("this check has no session");
    return session.learner;
  },
}));

import SubmissionRecordPage from "../app/(shell)/admin/submissions/[id]/page.tsx";
import { closeDb, db } from "../lib/db/pool.ts";
import { createSubmission } from "../lib/submissions/create.ts";
import { dispatchOnce } from "../lib/queue/dispatcher.ts";
import { writeResult } from "../lib/queue/result-writer.ts";
import { deleteMessage, receive } from "../lib/queue/shim.ts";
import { latestEvaluation, learnerFacing, saveEvaluation } from "../lib/eval/record.ts";
import { overrideBand } from "../lib/eval/override.ts";
import { runPanel } from "../lib/eval/panel.ts";
import { evaluationHistory } from "../lib/eval/history.ts";
import { currentJudgePrompts, runRegrade, type CurrentPrompts } from "../lib/eval/regrade.ts";
import { publicView } from "../lib/submissions/view.ts";
import { importFixtures, resetDatabase, seedLearner } from "./helpers.ts";

/** The prompt that replaced v1, as far as these tests are concerned. */
const CURRENT: CurrentPrompts = { rubric: "rubric.v2.md", defence: "defence.v1.md" };

let previousModelDir: string | undefined;

beforeAll(async () => {
  previousModelDir = process.env["FDEPREP_EMBED_MODEL_DIR"];
  process.env["FDEPREP_EMBED_MODEL_DIR"] = await mkdtemp(path.join(tmpdir(), "fdeprep-no-model-"));
});

beforeEach(async () => {
  await resetDatabase();
  await importFixtures();
});

afterAll(async () => {
  if (previousModelDir === undefined) delete process.env["FDEPREP_EMBED_MODEL_DIR"];
  else process.env["FDEPREP_EMBED_MODEL_DIR"] = previousModelDir;
  await closeDb();
});

const ANSWER = `## What I would measure

The forty conversations were written by the people who built the agent, so they
cover the failures those people already imagined. I would measure the refund
rate against orders that do not exist and the rate of refunds above the ceiling.

## What I would refuse to launch without

A hard cap enforced outside the model, and an adversarial set of at least two
hundred cases drawn from real traffic.`;

/** A design result as judge/handler.py writes it. */
function judged(percent: number, prompt: string | null, verdict = percent >= 65 ? "pass" : "fail") {
  return {
    verdict,
    score: percent,
    gates: {
      static: { status: "pass", checks: [] },
      probes: { status: "skipped", passed: 0, total: 0, cases: [] },
      rubric: {
        status: percent >= 65 ? "pass" : "fail", percent, total: percent, max_total: 100,
        threshold: 65,
        criteria: [{ criterion_id: "c1", label: "Names what a hand-written set cannot cover",
                     weight: 40, score: Math.round(percent * 0.4),
                     evidence_quote: "written by the people who built the agent",
                     quote_grounded: true }],
      },
    },
    model_calls: 1,
    consumes_allowance: true,
    requeue: false,
    ...(prompt ? { judge_prompt: prompt } : {}),
  } as Record<string, unknown>;
}

/** A judge that answers from a script and counts what it was asked. */
function fakeJudge(reply: (submissionId: number) => Record<string, unknown>) {
  const asked: number[] = [];
  const rejudge = async (submissionId: number) => {
    asked.push(submissionId);
    return reply(submissionId);
  };
  return Object.assign(rejudge, { asked });
}

let githubId = 0;

/** One learner, one design answer, committed with the contract given. */
async function graded(contract: Record<string, unknown>) {
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
  return { submissionId: submission.id, ...learner };
}

async function allowanceSpent(enrolmentId: number): Promise<number> {
  const { rows } = await db().query<{ total: string }>(
    "select coalesce(sum(count), 0) as total from rate_limit_counter where enrolment_id = $1",
    [enrolmentId]);
  return Number(rows[0]!.total);
}

async function terminal(submissionId: number) {
  const { rows } = await db().query<{ verdict: string; score: string; result: Record<string, any> }>(
    "select verdict::text, score, result from submission where id = $1", [submissionId]);
  return rows[0]!;
}

async function evaluationCount(): Promise<number> {
  const { rows } = await db().query<{ n: string }>("select count(*) as n from evaluation");
  return Number(rows[0]!.n);
}

describe("a dry run", () => {
  it("lists what it would regrade and judges and writes nothing", async () => {
    const { submissionId } = await graded(judged(88, "rubric.v1.md"));
    const judge = fakeJudge(() => judged(30, "rubric.v2.md"));
    const before = await evaluationCount();

    const report = await runRegrade({ current: CURRENT, limit: 25, dryRun: true, rejudge: judge });

    expect(report.candidates.map((c) => c.submissionId)).toEqual([submissionId]);
    expect(report.candidates[0]).toMatchObject(
      { judgePrompt: "rubric.v1.md", band: "strong", slug: "argue-the-eval-plan" });
    expect(report.results).toEqual([]);
    expect(judge.asked).toEqual([]);
    expect(await evaluationCount()).toBe(before);
  });
});

describe("a regrade", () => {
  it("appends an evaluation under the new prompt and leaves the old one as it was", async () => {
    const { submissionId, enrolmentId } = await graded(judged(88, "rubric.v1.md"));
    const old = await latestEvaluation(submissionId);
    const spent = await allowanceSpent(enrolmentId);
    const before = await terminal(submissionId);

    // The new prompt is stricter. Its own verdict would be a fail, and a
    // regrade does not get to say so.
    const report = await runRegrade({
      current: CURRENT, limit: 25, dryRun: false,
      rejudge: fakeJudge(() => judged(30, "rubric.v2.md")),
    });
    expect(report.results.map((r) => r.outcome.status)).toEqual(["written"]);

    // The old row is untouched and still readable.
    const { rows: [kept] } = await db().query<{ judge_prompt: string; band: string; state: string }>(
      "select judge_prompt, band, state::text from evaluation where id = $1", [old!.id]);
    expect(kept).toEqual({ judge_prompt: "rubric.v1.md", band: "strong", state: "complete" });

    // The newest row is the one that counts, and it names its own prompt.
    const newest = await latestEvaluation(submissionId);
    expect(newest!.id).not.toBe(old!.id);
    expect(newest).toMatchObject({ judgePrompt: "rubric.v2.md", band: "weak", state: "complete" });

    // The terminal verdict, the submission's score and the allowance stand.
    expect(newest!.verdict).toBe("pass");
    const after = await terminal(submissionId);
    expect(after.verdict).toBe("pass");
    expect(after.score).toBe(before.score);
    expect(await allowanceSpent(enrolmentId)).toBe(spent);

    // What the learner reads follows the newest evaluation, in one voice.
    const block = learnerFacing(newest!);
    expect(after.result["evaluation"]).toEqual(block.evaluation);
    expect(after.result["feedback_md"]).toBe(block.feedback_md);
    const view = JSON.stringify(await publicView(submissionId));
    expect(view).not.toContain("rubric.v");
    expect(view).not.toContain("judge_prompt");
  });

  it("never turns a failed answer into a pass, whatever the new prompt makes of it", async () => {
    const { submissionId } = await graded(judged(40, "rubric.v1.md"));

    await runRegrade({
      current: CURRENT, limit: 25, dryRun: false,
      rejudge: fakeJudge(() => judged(92, "rubric.v2.md")),
    });

    const newest = await latestEvaluation(submissionId);
    expect(newest).toMatchObject({ band: "strong", verdict: "fail", judgePrompt: "rubric.v2.md" });
    expect((await terminal(submissionId)).verdict).toBe("fail");
  });

  it("shows faculty both rows, newest first, each naming its prompt", async () => {
    const learner = await graded(judged(88, "rubric.v1.md"));
    await runRegrade({
      current: CURRENT, limit: 25, dryRun: false,
      rejudge: fakeJudge(() => judged(70, "rubric.v2.md")),
    });

    const record = await evaluationHistory(learner.submissionId);
    expect(record!.evaluations.map((e) => [e.judgePrompt, e.band, e.newest])).toEqual([
      ["rubric.v2.md", "adequate", true],
      ["rubric.v1.md", "strong", false],
    ]);
    // Faculty see who said what, which the learner never does.
    expect(record!.evaluations[0]!.seats.find((s) => s.panelist === "llm")).toMatchObject(
      { status: "ran", band: "adequate" });

    const { rows } = await db().query<{ action: string }>(
      "select action from audit_log where action = 'evaluation.regrade'");
    expect(rows).toHaveLength(1);

    // The page faculty open from Submissions and Disagreements.
    const open = () => SubmissionRecordPage({
      params: Promise.resolve({ id: String(learner.submissionId) }) });
    session.learner = { enrolmentId: learner.enrolmentId, cohortId: learner.cohortId,
                        userId: learner.userId, displayName: "Faculty", role: "faculty",
                        persona: "navigator" };
    const page = renderToStaticMarkup(await open()).replace(/<[^>]+>/g, " ");
    expect(page.indexOf("rubric.v2.md")).toBeGreaterThan(-1);
    expect(page.indexOf("rubric.v2.md")).toBeLessThan(page.indexOf("rubric.v1.md"));
    expect(page).toContain("What the learner reads");

    session.learner = { ...session.learner, role: "learner" };
    await expect(open()).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  });

  it("leaves a submission as it was when the judge does not complete", async () => {
    const { submissionId } = await graded(judged(88, "rubric.v1.md"));
    const before = await evaluationCount();

    const report = await runRegrade({
      current: CURRENT, limit: 25, dryRun: false,
      rejudge: fakeJudge(() => ({
        verdict: "error", score: null, consumes_allowance: false, model_calls: 0,
        message: "The judge could not reach the model. Your attempt was not counted. Try again.",
        gates: { static: { status: "skipped" }, probes: { status: "skipped" },
                 rubric: { status: "skipped" } },
      })),
    });

    expect(report.results[0]!.outcome).toMatchObject({ status: "unchanged", code: "judge_failed" });
    expect(await evaluationCount()).toBe(before);
    expect((await latestEvaluation(submissionId))!.judgePrompt).toBe("rubric.v1.md");
  });

  it("stops at the first answer the judge grades with some other prompt", async () => {
    // The judge that answers is still on v1 while this checkout says v2 is
    // current, which is a deploy that has not happened yet. Every further call
    // would grade under the old prompt again, so the run stops after one.
    await graded(judged(88, "rubric.v1.md"));
    await graded(judged(70, "rubric.v1.md"));
    const judge = fakeJudge(() => judged(60, "rubric.v1.md"));
    const before = await evaluationCount();

    const report = await runRegrade({ current: CURRENT, limit: 25, dryRun: false, rejudge: judge });

    expect(judge.asked).toHaveLength(1);
    expect(report.stopped).toContain("rubric.v1.md");
    expect(await evaluationCount()).toBe(before);
  });
});

describe("what a regrade selects", () => {
  it("takes the prompts other than the current one, or the one named", async () => {
    const older = await graded(judged(88, "rubric.v0.md"));
    const current = await graded(judged(88, "rubric.v1.md"));
    const now = { rubric: "rubric.v1.md", defence: "defence.v1.md" };

    const byDefault = await runRegrade({ current: now, limit: 25, dryRun: true });
    expect(byDefault.candidates.map((c) => c.submissionId)).toEqual([older.submissionId]);

    const named = await runRegrade({ current: now, from: "rubric.v1.md", limit: 25, dryRun: true });
    expect(named.candidates.map((c) => c.submissionId)).toEqual([current.submissionId]);
  });

  it("takes the oldest first, up to the batch limit", async () => {
    const first = await graded(judged(88, "rubric.v1.md"));
    const second = await graded(judged(70, "rubric.v1.md"));
    await graded(judged(40, "rubric.v1.md"));

    const report = await runRegrade({ current: CURRENT, limit: 2, dryRun: true });
    expect(report.candidates.map((c) => c.submissionId))
      .toEqual([first.submissionId, second.submissionId]);
  });

  it("leaves alone what a regrade must not touch", async () => {
    // A faculty correction: a person settled that grade, and a regrade that
    // superseded it would undo the correction without anybody deciding to.
    const corrected = await graded(judged(88, "rubric.v1.md"));
    await overrideBand({
      evaluationId: (await latestEvaluation(corrected.submissionId))!.id,
      reviewerId: corrected.userId, band: "adequate", note: "One gap and one gate.",
    });

    // A partial evaluation: the drain owes it a re-run, and it gets that first.
    const owed = await graded(judged(88, "rubric.v1.md"));
    await saveEvaluation(await runPanel({
      submissionId: owed.submissionId, complexity: "C4", artefactType: "design",
      body: ANSWER, problemSlug: "argue-the-eval-plan",
    }, [
      { name: "static", run: async () => ({ status: "ran", ms: 0, findings: [], verdict: "pass",
                                            scoreContribution: 88 }) },
      { name: "pretrained", run: async () => ({ status: "unavailable", reason: "timeout", ms: 0,
                                                findings: [] }) },
      { name: "llm", run: async () => ({ status: "ran", ms: 0, findings: [], band: "strong",
                                         prompt: "rubric.v1.md" }) },
    ]), owed.enrolmentId);

    // An answer no model graded, because the static gate stopped it.
    await graded({
      verdict: "fail", score: 0,
      gates: { static: { status: "fail", checks: [] }, probes: { status: "skipped" },
               rubric: { status: "skipped" } },
      model_calls: 0, consumes_allowance: true, requeue: false,
    });

    // And an error, which has no grade to move.
    await graded({ verdict: "error", score: null, consumes_allowance: false, gates: {} });

    const report = await runRegrade({ current: CURRENT, limit: 25, dryRun: true });
    expect(report.candidates).toEqual([]);
  });
});

describe("the current prompts", () => {
  it("are the ones the judge's own constants name, and each is a file", () => {
    const current = currentJudgePrompts();
    expect(current).toEqual({ rubric: "rubric.v1.md", defence: "defence.v1.md" });
    const prompts = path.join(import.meta.dirname, "..", "..", "judge", "prompts");
    for (const name of Object.values(current)) {
      expect(existsSync(path.join(prompts, name))).toBe(true);
    }
  });
});
