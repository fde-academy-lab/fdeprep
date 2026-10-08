/**
 * Which judge prompt graded an evaluation. S15.3, docs/10 section 10.
 *
 * Migration 025 adds `evaluation.judge_prompt`, and eval/ writes it on every
 * new evaluation from the `judge_prompt` the judge returns. These drive the
 * real write paths, the result writer and the override, with contracts in the
 * shape judge/handler.py writes them: the rubric score sits on the gate as
 * `percent`, and a defence carries its score at the top of the result.
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
import { latestEvaluation } from "../lib/eval/record.ts";
import { overrideBand } from "../lib/eval/override.ts";
import { panelistsFor } from "../lib/eval/from-result.ts";
import { runPanel } from "../lib/eval/panel.ts";
import { importFixtures, resetDatabase, seedLearner } from "./helpers.ts";

let learner: Awaited<ReturnType<typeof seedLearner>>;
let previousModelDir: string | undefined;

beforeAll(async () => {
  // Panelist 2 sits out every case here, on every host, so the evaluation
  // state depends on the judge's prompt and score and on nothing else.
  previousModelDir = process.env["FDEPREP_EMBED_MODEL_DIR"];
  process.env["FDEPREP_EMBED_MODEL_DIR"] = await mkdtemp(path.join(tmpdir(), "fdeprep-no-model-"));
});

beforeEach(async () => {
  await resetDatabase();
  await importFixtures();
  learner = await seedLearner();
});

afterAll(async () => {
  if (previousModelDir === undefined) delete process.env["FDEPREP_EMBED_MODEL_DIR"];
  else process.env["FDEPREP_EMBED_MODEL_DIR"] = previousModelDir;
  await closeDb();
});

const DESIGN_ANSWER = `## What I would measure

The forty conversations were written by the people who built the agent, so they
cover the failures those people already imagined. I would measure the refund
rate against orders that do not exist and the rate of refunds above the ceiling.

## What I would refuse to launch without

A hard cap enforced outside the model, and an adversarial set of at least two
hundred cases drawn from real traffic.`;

/** A design result as judge/handler.py writes it: `percent` on the gate, no `score`. */
function judged(percent: number, prompt: string | null): Record<string, unknown> {
  const verdict = percent >= 65 ? "pass" : "fail";
  return {
    verdict,
    score: percent,
    gates: {
      static: { status: "pass", checks: [] },
      probes: { status: "skipped", passed: 0, total: 0, cases: [] },
      rubric: {
        status: verdict, percent, total: percent, max_total: 100, threshold: 65,
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
  };
}

async function problemId(slug: string): Promise<number> {
  const { rows } = await db().query<{ id: string }>("select id from problem where slug = $1", [slug]);
  return Number(rows[0]!.id);
}

/** Drive one submission to a committed verdict carrying the contract given. */
async function commit(slug: string, contract: Record<string, unknown>, body = DESIGN_ANSWER) {
  const submission = await createSubmission({
    enrolmentId: learner.enrolmentId, cohortId: learner.cohortId,
    problemId: await problemId(slug), kind: "submit", body,
  });
  await dispatchOnce();
  const lane = slug === "echo-the-question" ? "submissions" : "judgements";
  const [message] = await receive(lane, 1);
  expect(await writeResult({
    submission_id: submission.id,
    lease_token: String(message!.body["lease_token"]),
    fencing_token: Number(message!.body["fencing_token"]),
    body_sha256: submission.bodySha256,
    result: contract,
  })).toBe(true);
  await deleteMessage(message!.id);
  return submission.id;
}

const CODE_PASS = {
  verdict: "pass",
  score: 100,
  gates: {
    public: { status: "pass", passed: 2, total: 2, cases: [] },
    hidden: { status: "pass", passed: 2, total: 2, cases: [] },
    adversarial: { status: "skipped", passed: 0, total: 0, cases: [] },
  },
  budget: { llm_calls: 2, tool_calls: 1, wall_ms: 12 },
  trace: { submission_id: 0, steps: [], flags: [] },
};

describe("migration 025 keeps the previous release working", () => {
  it("adds a nullable text column with no default", async () => {
    const { rows } = await db().query<{ data_type: string; is_nullable: string; column_default: string | null }>(
      `select data_type, is_nullable, column_default from information_schema.columns
        where table_name = 'evaluation' and column_name = 'judge_prompt'`);
    expect(rows).toEqual([{ data_type: "text", is_nullable: "YES", column_default: null }]);
  });

  it("still accepts the inserts the previous release makes, and leaves the prompt empty", async () => {
    const id = await commit("echo-the-question", CODE_PASS, "def run_agent(q, llm, tools): return q");

    // saveEvaluation as the previous release wrote it, word for word.
    const { rows: [saved] } = await db().query<{ id: string }>(
      `insert into evaluation
         (submission_id, enrolment_id, complexity, state, verdict, score,
          score_provisional, confidence, band, panel, disagreement, feedback_md)
       values ($1, $2, $3, $4::evaluation_state, $5::verdict, $6, $7,
               $8::panel_confidence, $9, $10, $11, $12)
       returning id`,
      [id, learner.enrolmentId, "C2", "complete", "pass", 100, false, "high", null,
       JSON.stringify([{ panelist: "static", status: "ran", ms: 0, findings: [] }]), null,
       "- Every check this answer was measured against passed."]);

    // And the override's insert, also as it stood.
    const { rows: [overridden] } = await db().query<{ id: string }>(
      `insert into evaluation
         (submission_id, enrolment_id, complexity, state, verdict, score,
          score_provisional, confidence, band, panel, disagreement, feedback_md,
          overridden_by, override_note)
       select $1, e.enrolment_id, e.complexity, 'complete',
              coalesce($2::verdict, e.verdict), $3, false, 'high', $4,
              $5::jsonb, null, e.feedback_md, $6, $7
         from evaluation e where e.id = $8
       returning id`,
      [id, null, 90, "strong", JSON.stringify([]), learner.userId, "A note.", saved!.id]);

    const { rows } = await db().query<{ judge_prompt: string | null }>(
      "select judge_prompt from evaluation where id in ($1, $2)", [saved!.id, overridden!.id]);
    expect(rows.map((r) => r.judge_prompt)).toEqual([null, null]);
  });
});

describe("eval/ records the prompt on every new evaluation", () => {
  it("names the prompt the judge graded a design answer with", async () => {
    const id = await commit("argue-the-eval-plan", judged(88, "rubric.v1.md"));

    const evaluation = await latestEvaluation(id);
    expect(evaluation!.judgePrompt).toBe("rubric.v1.md");
    // The judge writes `percent`, and panelist 3 reads it. Before this it read
    // only `score`, so every real design answer went partial and owed a
    // re-run nothing was going to make good.
    const llm = evaluation!.panel.find((p) => p.panelist === "llm");
    expect(llm).toMatchObject({ status: "ran", band: "strong", prompt: "rubric.v1.md" });
    expect(evaluation!.state).toBe("complete");
  });

  it("names none where no judge prompt graded the answer", async () => {
    const code = await commit("echo-the-question", CODE_PASS, "def run_agent(q, llm, tools): return q");
    expect((await latestEvaluation(code))!.judgePrompt).toBeNull();

    const stopped = await commit("argue-the-eval-plan", {
      verdict: "fail", score: 0,
      gates: {
        static: { status: "fail", checks: [{ rule: "length", status: "fail", message: "Too short." }] },
        probes: { status: "skipped", passed: 0, total: 0, cases: [] },
        rubric: { status: "skipped", passed: 0, total: 0, cases: [] },
      },
      model_calls: 0, consumes_allowance: true, requeue: false,
    });
    expect((await latestEvaluation(stopped))!.judgePrompt).toBeNull();
  });

  it("ignores a prompt name that is not a file name", async () => {
    const id = await commit("argue-the-eval-plan", judged(88, "../../etc/passwd"));
    expect((await latestEvaluation(id))!.judgePrompt).toBeNull();
  });

  it("keeps the prompt of the row an override corrects", async () => {
    const id = await commit("argue-the-eval-plan", judged(88, "rubric.v1.md"));
    const graded = await latestEvaluation(id);

    await overrideBand({
      evaluationId: graded!.id, reviewerId: learner.userId, band: "adequate",
      note: "Names one gap and one gate, which is the adequate exemplar.",
    });

    const corrected = await latestEvaluation(id);
    expect(corrected!.id).not.toBe(graded!.id);
    expect(corrected!.judgePrompt).toBe("rubric.v1.md");
  });
});

describe("a defence, in the shape the judge writes it", () => {
  const input = {
    submissionId: 1, complexity: "C4" as const, artefactType: "defence",
    body: "I retry with a different prompt.", problemSlug: "a-problem",
  };

  it("takes its band from the score at the top of the result", async () => {
    const evaluation = await runPanel(input, panelistsFor({
      verdict: "pass", score: 70,
      gates: {
        static: { status: "pass", checks: [] },
        probes: { status: "skipped", passed: 0, total: 0, cases: [] },
        rubric: { status: "pass", criteria: [{ criterion_id: "d1", score: 70,
                                                evidence_quote: "a different prompt",
                                                quote_grounded: true }] },
      },
      judge_prompt: "defence.v1.md",
    }));

    expect(evaluation.panel.find((p) => p.panelist === "llm")).toMatchObject(
      { status: "ran", band: "adequate", prompt: "defence.v1.md" });
    expect(evaluation.judgePrompt).toBe("defence.v1.md");
  });

  it("treats one the word cap stopped as never judged, so no re-run is owed", async () => {
    const evaluation = await runPanel(input, panelistsFor({
      verdict: "fail", score: 0,
      gates: {
        static: { status: "fail", checks: [] },
        probes: { status: "skipped", passed: 0, total: 0, cases: [] },
        rubric: { status: "fail", criteria: [] },
      },
    }));

    expect(evaluation.panel.find((p) => p.panelist === "llm")!.status).toBe("skipped");
    expect(evaluation.state).toBe("complete");
    expect(evaluation.judgePrompt).toBeNull();
  });
});
