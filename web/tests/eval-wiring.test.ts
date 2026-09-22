/**
 * The panel, reading the pipeline that already exists.
 *
 * The panel tests use fake panelists to prove ordering and degradation. These
 * drive a real submission through createSubmission, the dispatcher and the
 * result writer, and assert that an evaluation record comes out the other end.
 * Until this file existed the panel had been graded entirely by panelists
 * returning what they were told to return, which proves orchestration and
 * nothing about fit.
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../lib/db/pool.ts";
import { createSubmission } from "../lib/submissions/create.ts";
import { dispatchOnce } from "../lib/queue/dispatcher.ts";
import { writeResult } from "../lib/queue/result-writer.ts";
import { receive } from "../lib/queue/shim.ts";
import { latestEvaluation } from "../lib/eval/record.ts";
import { complexityOf, panelistsFor } from "../lib/eval/from-result.ts";
import { bandForScore } from "../lib/policy/bands.ts";
import { runPanel } from "../lib/eval/panel.ts";
import { importFixtures, resetDatabase, seedLearner } from "./helpers.ts";

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
  const { rows } = await db().query<{ id: string }>(
    "select id from problem where slug = $1", [slug]);
  return Number(rows[0]!.id);
}

/** Drive a submission all the way to a committed verdict. */
async function commit(
  slug: string,
  result: Record<string, unknown>,
  kind: "run" | "submit" = "submit",
): Promise<number> {
  const submission = await createSubmission({
    enrolmentId: learner.enrolmentId, cohortId: learner.cohortId,
    problemId: await problemId(slug), kind,
    body: "def run_agent(question, llm, tools): return question",
  });
  await dispatchOnce();
  const [message] = await receive(
    (await db().query<{ t: string }>(
      "select artefact_type::text as t from problem where slug = $1", [slug])
    ).rows[0]!.t === "code" ? "submissions" : "judgements", 1);

  const ok = await writeResult({
    submission_id: submission.id,
    lease_token: String(message!.body["lease_token"]),
    fencing_token: Number(message!.body["fencing_token"]),
    body_sha256: submission.bodySha256,
    result,
  });
  expect(ok).toBe(true);
  return submission.id;
}

const PASSING = {
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

describe("every committed submission gets an evaluation record", () => {
  it("records one for a passing code submission", async () => {
    const id = await commit("echo-the-question", PASSING);

    const evaluation = await latestEvaluation(id);
    expect(evaluation).not.toBeNull();
    expect(evaluation!.verdict).toBe("pass");
    expect(evaluation!.state).toBe("complete");
    // A code problem defaults to C2, which asks for no model call. That is
    // what already happens: the dispatcher sends code to the runner and never
    // to the judge, so the panel is describing the pipeline rather than
    // changing it.
    expect(evaluation!.complexity).toBe("C2");
    expect(evaluation!.panel.find((p) => p.panelist === "llm")?.status).toBe("skipped");
  });

  it("puts the one voice and the state into what the front end renders", async () => {
    const id = await commit("echo-the-question", {
      ...PASSING,
      verdict: "fail",
      score: 45,
      gates: {
        ...PASSING.gates,
        hidden: { status: "fail", passed: 1, total: 2,
                  cases: [{ name: "h1", status: "fail", message: "expected a retry, saw none" }] },
      },
    });

    const { rows } = await db().query<{ result: Record<string, any> }>(
      "select result from submission where id = $1", [id]);
    const contract = rows[0]!.result;

    expect(typeof contract["feedback_md"]).toBe("string");
    expect(contract["feedback_md"]).toContain("expected a retry, saw none");
    expect(contract["evaluation"]).toEqual({
      state: "complete", confidence: "high", provisional: false,
    });
  });

  it("carries no panelist name into the rendered contract", async () => {
    const id = await commit("echo-the-question", PASSING);
    const { rows } = await db().query<{ result: Record<string, any> }>(
      "select result from submission where id = $1", [id]);

    const rendered = JSON.stringify({
      feedback_md: rows[0]!.result["feedback_md"],
      evaluation: rows[0]!.result["evaluation"],
    }).toLowerCase();
    for (const leak of ["static", "pretrained", "llm", "panelist"]) {
      expect(rendered).not.toContain(leak);
    }
  });

  it("records an error evaluation without a verdict or a score", async () => {
    const id = await commit("echo-the-question", {
      verdict: "error",
      score: null,
      message: "The runner timed out after 10 seconds.",
      gates: {},
      budget: {},
      trace: null,
    });

    const evaluation = await latestEvaluation(id);
    expect(evaluation!.state).toBe("error");
    expect(evaluation!.verdict).toBeNull();
    expect(evaluation!.score).toBeNull();
    // docs/03 section 8 and docs/10 section 9 agree, and they are the same
    // rule: infrastructure is the platform's problem.
    const { rows } = await db().query<{ verdict: string }>(
      "select verdict::text from submission where id = $1", [id]);
    expect(rows[0]!.verdict).toBe("error");
  });

  it("keeps the verdict when the panel hits a database error", async () => {
    // The realistic version of this is a deploy that shipped the code ahead of
    // its migration. It produces a Postgres error, which aborts the whole
    // transaction; without the savepoint the committed verdict goes with it
    // and the learner's submission never resolves.
    //
    // A JavaScript throw would not exercise this: it leaves the transaction
    // healthy and a plain try/catch would be enough. The table has to actually
    // be missing.
    await db().query("alter table evaluation rename to evaluation_parked");
    try {
      const id = await commit("echo-the-question", PASSING);

      const { rows } = await db().query<{ verdict: string }>(
        "select verdict::text from submission where id = $1", [id]);
      expect(rows[0]!.verdict).toBe("pass");

      // The evaluation is what was lost, and the loss is logged rather than
      // silent, because analytics/ reports the gap.
      const events = await db().query<{ message: string }>(
        "select message from runner_event where submission_id = $1", [id]);
      expect(events.rows.map((r) => r.message)).toContain("evaluation not recorded");
    } finally {
      await db().query("alter table evaluation_parked rename to evaluation");
    }
  });
});

describe("the judge's rubric score becomes a band, once", () => {
  it("maps the authored exemplar scores to the bands they were authored as", () => {
    // Measured across the 60 graded exemplars: strong runs 88 to 92, adequate
    // 60 to 66, weak 26 to 31. Every authored score has to land in its own
    // band, or the thresholds are wrong rather than the content.
    for (const score of [88, 89, 90, 91, 92]) expect(bandForScore(score)).toBe("strong");
    for (const score of [60, 62, 64, 66]) expect(bandForScore(score)).toBe("adequate");
    for (const score of [26, 28, 30, 31]) expect(bandForScore(score)).toBe("weak");
    expect(bandForScore(5)).toBe("off_question");
  });

  it("reads the rubric gate and nothing else for the band", async () => {
    const panel = await runPanel({
      submissionId: 1, complexity: "C4", artefactType: "design",
      body: "An argument.", problemSlug: "a-problem",
    }, panelistsFor({
      verdict: "pass",
      score: 71,
      gates: {
        static: { status: "pass", checks: [] },
        probes: { status: "skipped" },
        rubric: { status: "pass", score: 71 },
      },
    }));

    expect(panel.panel.find((p) => p.panelist === "llm")?.band).toBe("adequate");
    expect(panel.band).toBe("adequate");
  });

  it("treats a skipped rubric gate as the cheap-first rule working, not an outage", async () => {
    const panel = await runPanel({
      submissionId: 1, complexity: "C4", artefactType: "design",
      body: "An argument.", problemSlug: "a-problem",
    }, panelistsFor({
      verdict: "fail",
      score: 0,
      gates: {
        static: { status: "fail", checks: [{ rule: "length", status: "fail",
                                             message: "The answer is 40 words, under the 300 minimum." }] },
        probes: { status: "skipped" },
        rubric: { status: "skipped" },
      },
    }));

    // Skipped, not unavailable, so the evaluation is complete rather than
    // promising a review that is never coming.
    expect(panel.panel.find((p) => p.panelist === "llm")?.status).toBe("skipped");
    expect(panel.state).toBe("complete");
    expect(panel.verdict).toBe("fail");
    expect(panel.feedbackMd).toContain("under the 300 minimum");
  });
});

describe("panelist 2 without a pool to compare against", () => {
  it("skips rather than reporting unavailable when it has no database context", async () => {
    // An evaluation assembled from a bare contract was never going to have a
    // neighbour pool. That is a different thing from an encoder that failed,
    // and the record has to say which.
    const panel = await runPanel({
      submissionId: 1, complexity: "C4", artefactType: "design",
      body: "An argument.", problemSlug: "a-problem",
    }, panelistsFor({
      verdict: "pass", score: 80,
      gates: { static: { status: "pass", checks: [] }, rubric: { status: "pass", score: 80 } },
    }));

    const p2 = panel.panel.find((p) => p.panelist === "pretrained");
    expect(p2!.status).toBe("skipped");
    expect(p2!.reason).toBe("no_pool_context");
  });

  it("does not promise a review that never lands", async () => {
    // A skipped panelist is a deployment fact, not an outage. Marking these
    // partial would queue a re-evaluation nobody can ever drain, and a promise
    // nobody drains is worse than a plain failure.
    const panel = await runPanel({
      submissionId: 1, complexity: "C4", artefactType: "design",
      body: "An argument.", problemSlug: "a-problem",
    }, panelistsFor({
      verdict: "pass", score: 80,
      gates: { static: { status: "pass", checks: [] }, rubric: { status: "pass", score: 80 } },
    }));

    expect(panel.state).toBe("complete");
    expect(panel.scoreProvisional).toBe(false);
    expect(panel.feedbackMd).not.toContain("still running");
  });
});

describe("a host without the embedding model", () => {
  const DESIGN = {
    verdict: "pass",
    score: 80,
    gates: {
      static: { status: "pass", checks: [] },
      probes: { status: "skipped" },
      rubric: { status: "pass", score: 80 },
    },
    budget: { llm_calls: 1, tool_calls: 0, wall_ms: 900 },
    trace: { submission_id: 0, steps: [], flags: [] },
  };

  it("finishes the evaluation rather than queueing a re-run nobody will drain", async () => {
    // The real subprocess, against a directory with no weights in it, which
    // is what a worker built without the fetch step actually looks like. A
    // worker in that state never encodes anything, so marking this partial
    // would promise every learner a review that is never coming.
    const previous = process.env["FDEPREP_EMBED_MODEL_DIR"];
    process.env["FDEPREP_EMBED_MODEL_DIR"] = await mkdtemp(
      path.join(tmpdir(), "fdeprep-no-model-"));
    try {
      const id = await commit("argue-the-eval-plan", DESIGN);
      const evaluation = await latestEvaluation(id);

      expect(evaluation!.state).toBe("complete");
      expect(evaluation!.scoreProvisional).toBe(false);
      const p2 = evaluation!.panel.find((p) => p.panelist === "pretrained");
      expect(p2!.status).toBe("skipped");
      expect(["model_missing", "dependency_missing"]).toContain(p2!.reason);
      // The band still comes from the judge, so the learner loses detail and
      // never loses a grade.
      expect(evaluation!.band).toBe("strong");
      expect(evaluation!.feedbackMd).not.toContain("still running");
    } finally {
      if (previous === undefined) delete process.env["FDEPREP_EMBED_MODEL_DIR"];
      else process.env["FDEPREP_EMBED_MODEL_DIR"] = previous;
    }
  });
});

describe("complexity comes from the problem when it declares one", () => {
  it("prefers an explicit level over the artefact default", () => {
    expect(complexityOf("code", "C4")).toBe("C4");
    // The scale stops at C4, so a problem declaring a fifth level falls back
    // to the artefact default rather than being taken at its word.
    expect(complexityOf("code", "C5")).toBe("C2");
    expect(complexityOf("code", undefined)).toBe("C2");
    expect(complexityOf("code", "epic")).toBe("C2");
    expect(complexityOf("defence", undefined)).toBe("C4");
    // A defence is a written argument about a choice, so the problem's own
    // level does not carry over. Without this, a defence on a C2 code problem
    // would be graded at a level that asks for no model at all and the judge's
    // band on the argument would be dropped.
    expect(complexityOf("defence", "C2")).toBe("C4");
  });
});
