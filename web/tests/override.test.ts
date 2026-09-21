/**
 * The faculty override. docs/00 section 3.1, docs/10 sections 9.7 and 13.
 *
 * The disagreement queue let faculty say a grade was wrong. This lets them fix
 * it, which is the half that was missing: a wrong grade a human has already
 * identified and cannot change is a worse position than not knowing.
 *
 * Two things these tests pin that are easy to get wrong and invisible when you
 * do. An override writes a new evaluation rather than editing one, because the
 * table is append-only and an appeal needs to read what the panel said before
 * a human disagreed with it. And it recomputes the competency cell rather than
 * merging into it, because the merge is one-way and a correction that can only
 * ever raise a grade cannot correct an over-generous one.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../lib/db/pool.ts";
import { createSubmission } from "../lib/submissions/create.ts";
import { dispatchOnce } from "../lib/queue/dispatcher.ts";
import { writeResult } from "../lib/queue/result-writer.ts";
import { receive } from "../lib/queue/shim.ts";
import { latestEvaluation } from "../lib/eval/record.ts";
import { disagreementQueue, recordReview } from "../lib/eval/review.ts";
import {
  NoteRequired, NotOverridable, UnknownBand, overrideBand,
} from "../lib/eval/override.ts";
import { bestStates, heatmapFor, type State } from "../lib/competency/score.ts";
import { publicView } from "../lib/submissions/view.ts";
import { importFixtures, resetDatabase, seedLearner } from "./helpers.ts";

let faculty: number;
let cohortId: number;
let nextLearner = 10;

beforeEach(async () => {
  await resetDatabase();
  await importFixtures();
  const seed = await seedLearner({ githubId: 900, login: "faculty1" });
  cohortId = seed.cohortId;
  await db().query("update enrolment set role = 'faculty' where id = $1", [seed.enrolmentId]);
  faculty = seed.userId;
  nextLearner = 10;
});

afterAll(async () => {
  await closeDb();
});

async function problemId(slug: string): Promise<number> {
  const { rows } = await db().query<{ id: string }>(
    "select id from problem where slug = $1", [slug]);
  return Number(rows[0]!.id);
}

/**
 * A design submission driven all the way to a committed verdict.
 *
 * The real pipeline rather than a hand-written evaluation row, because what is
 * being tested is whether an override moves the numbers the pipeline produced.
 */
async function graded(options: {
  slug?: string;
  verdict?: string;
  score?: number;
  rubric?: Record<string, unknown>;
  probes?: Record<string, unknown>;
  /** Reuse a learner, for the cases that need more than one submission. */
  enrolmentId?: number;
}): Promise<{ submissionId: number; enrolmentId: number; evaluationId: number }> {
  const slug = options.slug ?? "argue-the-eval-plan";
  const githubId = nextLearner;
  nextLearner += 1;
  const learner = options.enrolmentId
    ? { enrolmentId: options.enrolmentId }
    : await seedLearner({ githubId, cohortId });

  const submission = await createSubmission({
    enrolmentId: learner.enrolmentId, cohortId,
    problemId: await problemId(slug), kind: "submit",
    body: "## What I would measure\n\nAn argument about the release threshold.",
  });
  await dispatchOnce();
  const [message] = await receive("judgements", 1);

  const ok = await writeResult({
    submission_id: submission.id,
    lease_token: String(message!.body["lease_token"]),
    fencing_token: Number(message!.body["fencing_token"]),
    body_sha256: submission.bodySha256,
    result: {
      verdict: options.verdict ?? "fail",
      score: options.score ?? 29,
      gates: {
        static: { status: "pass", checks: [] },
        ...(options.probes ? { probes: options.probes } : { probes: { status: "skipped" } }),
        rubric: options.rubric ?? { status: "fail", score: options.score ?? 29, threshold: 65 },
      },
      budget: { llm_calls: 1, tool_calls: 0, wall_ms: 900 },
      trace: { submission_id: 0, steps: [], flags: [] },
    },
  });
  expect(ok).toBe(true);

  const evaluation = await latestEvaluation(submission.id);
  return {
    submissionId: submission.id,
    enrolmentId: learner.enrolmentId,
    evaluationId: evaluation!.id,
  };
}

async function cells(enrolmentId: number): Promise<State[]> {
  return (await heatmapFor(db(), enrolmentId)).map((row) => row.state);
}

describe("an override is a new evaluation, never an edit", () => {
  it("leaves the panel's own record intact and supersedes it", async () => {
    const { submissionId, evaluationId } = await graded({ score: 29 });

    const id = await overrideBand({
      evaluationId, reviewerId: faculty, band: "strong",
      note: "Two numeric gates and the cost of a wrong refund. This is strong.",
    });

    expect(id).not.toBe(evaluationId);
    // The original is still readable, which is what an appeal reads.
    const { rows } = await db().query<{ band: string; score: string }>(
      "select band, score from evaluation where id = $1", [evaluationId]);
    expect(rows[0]!.band).toBe("weak");

    const latest = await latestEvaluation(submissionId);
    expect(latest!.id).toBe(id);
    expect(latest!.band).toBe("strong");
    expect(latest!.confidence).toBe("high");
  });

  it("records who overrode it and why", async () => {
    const { evaluationId } = await graded({});

    const id = await overrideBand({
      evaluationId, reviewerId: faculty, band: "adequate",
      note: "Names one gap and one gate, which is the adequate exemplar.",
    });

    const { rows } = await db().query<{ overridden_by: string; override_note: string }>(
      "select overridden_by, override_note from evaluation where id = $1", [id]);
    expect(Number(rows[0]!.overridden_by)).toBe(faculty);
    expect(rows[0]!.override_note).toContain("adequate exemplar");
  });

  it("keeps what each panelist said, so the appeal path can still read it", async () => {
    const { evaluationId } = await graded({});

    const id = await overrideBand({ evaluationId, reviewerId: faculty, band: "strong",
                                    note: "A strong answer." });

    const latest = await db().query<{ panel: Array<{ panelist: string; band?: string }> }>(
      "select panel from evaluation where id = $1", [id]);
    const seats = latest.rows[0]!.panel.map((p) => p.panelist);
    expect(seats).toContain("static");
    expect(seats).toContain("faculty");
    expect(latest.rows[0]!.panel.find((p) => p.panelist === "faculty")?.band).toBe("strong");
  });

  it("carries no faculty name into what the learner reads", async () => {
    const { submissionId, evaluationId } = await graded({});

    await overrideBand({ evaluationId, reviewerId: faculty, band: "strong",
                         note: "A strong answer." });

    const { rows } = await db().query<{ result: Record<string, unknown> }>(
      "select result from submission where id = $1", [submissionId]);
    const rendered = JSON.stringify({
      feedback_md: rows[0]!.result["feedback_md"],
      evaluation: rows[0]!.result["evaluation"],
    }).toLowerCase();
    for (const leak of ["faculty", "override", "panelist", "reviewer", "faculty1"]) {
      expect(rendered).not.toContain(leak);
    }
  });

  it("takes the row out of the disagreement queue", async () => {
    // The loop closing. A settled argument is not a row somebody still owes a
    // decision on.
    const { submissionId } = await graded({});
    const { rows } = await db().query<{ id: string }>(
      `update evaluation set disagreement = '{"bands":["weak","strong"],"held":"weak"}'
        where submission_id = $1 returning id`, [submissionId]);
    const evaluationId = Number(rows[0]!.id);
    await recordReview({ evaluationId, reviewerId: faculty, disposition: "disputed",
                         note: "The judge was right." });
    expect((await disagreementQueue({ disposition: "disputed" })).rows).toHaveLength(1);

    await overrideBand({ evaluationId, reviewerId: faculty, band: "strong",
                         note: "Raised to strong." });

    expect((await disagreementQueue({ disposition: "disputed" })).rows).toEqual([]);
    expect((await disagreementQueue({ disposition: "all" })).rows).toEqual([]);
  });
});

describe("what the learner's grade does", () => {
  it("moves the submission the learner reads, not only the evaluation", async () => {
    const { submissionId, evaluationId } = await graded({ verdict: "fail", score: 29 });

    await overrideBand({ evaluationId, reviewerId: faculty, band: "strong",
                         note: "Raised to strong." });

    const { rows } = await db().query<{ score: string; verdict: string }>(
      "select score, verdict::text from submission where id = $1", [submissionId]);
    expect(Number(rows[0]!.score)).toBe(90);
    // A design answer passes at adequate or better, which is the rule the judge
    // already uses: its threshold is the adequate exemplar's own score.
    expect(rows[0]!.verdict).toBe("pass");
  });

  it("never applies the rise-only floor a re-evaluation gets", async () => {
    // saveEvaluation floors a complete score at the partial it replaces, because
    // the platform finishing its own work may not cost a learner points. A human
    // saying an answer was graded too generously is the opposite case.
    const { evaluationId } = await graded({ verdict: "pass", score: 90,
      rubric: { status: "pass", score: 90, threshold: 65 } });

    const id = await overrideBand({ evaluationId, reviewerId: faculty, band: "weak",
                                    note: "The gates are adjectives, not measurements." });

    const { rows } = await db().query<{ score: string }>(
      "select score from evaluation where id = $1", [id]);
    expect(Number(rows[0]!.score)).toBe(29);
  });

  it("leaves a verdict alone when a probe battery decided it", async () => {
    // A prompt problem's verdict comes from its probes, not from the rubric.
    // Overruling a deterministic battery is a different decision from
    // regrading an argument, and this one does not make it.
    const { submissionId, evaluationId } = await graded({
      slug: "harden-the-leaky-prompt", verdict: "pass", score: 70,
      probes: { status: "pass", passed: 3, total: 3, cases: [] },
      rubric: { status: "pass", score: 70, threshold: 65 },
    });

    await overrideBand({ evaluationId, reviewerId: faculty, band: "weak",
                         note: "The prompt passes the probes and the argument is thin." });

    const { rows } = await db().query<{ score: string; verdict: string }>(
      "select score, verdict::text from submission where id = $1", [submissionId]);
    expect(Number(rows[0]!.score)).toBe(29);
    expect(rows[0]!.verdict).toBe("pass");
  });
});

describe("what the learner is told when their grade moves", () => {
  it("says a person reviewed it, which way it went, and why", async () => {
    // A learner who saw 29 and later sees 90 with no explanation learns that
    // the number is arbitrary. The note faculty wrote is the answer to the
    // question they would otherwise have to ask somebody.
    const { submissionId, evaluationId } = await graded({ verdict: "fail", score: 29 });

    await overrideBand({ evaluationId, reviewerId: faculty, band: "strong",
                         note: "Two numeric gates and the cost of a wrong refund." });

    const { rows } = await db().query<{ result: Record<string, any> }>(
      "select result from submission where id = $1", [submissionId]);
    const correction = rows[0]!.result["evaluation"]["correction"];
    expect(correction.direction).toBe("raised");
    expect(correction.note).toBe("Two numeric gates and the cost of a wrong refund.");
    expect(typeof correction.at).toBe("string");
  });

  it("says so just as plainly when the grade goes down", async () => {
    // The case that costs trust if it is hidden. A learner who organised their
    // week around a pass deserves to be told it moved and why, not to find out
    // by noticing a different number.
    const { submissionId, evaluationId } = await graded({ verdict: "pass", score: 90,
      rubric: { status: "pass", score: 90, threshold: 65 } });

    await overrideBand({ evaluationId, reviewerId: faculty, band: "weak",
                         note: "Right headings, no argument under them." });

    const { rows } = await db().query<{ result: Record<string, any> }>(
      "select result from submission where id = $1", [submissionId]);
    expect(rows[0]!.result["evaluation"]["correction"].direction).toBe("lowered");
  });

  it("names no reviewer, because the decision belongs to the programme", async () => {
    // Naming the individual invites a learner to lobby them. Faculty see who
    // on the record; a learner sees that a person reviewed it.
    const { submissionId, evaluationId } = await graded({});

    await overrideBand({ evaluationId, reviewerId: faculty, band: "strong",
                         note: "A strong answer." });

    const { rows } = await db().query<{ result: Record<string, any> }>(
      "select result from submission where id = $1", [submissionId]);
    // Asserting an id does not appear in a JSON blob proves nothing when the
    // id is a single digit that a timestamp also contains. The real claim is
    // that the block carries these three fields and no fourth.
    const correction = rows[0]!.result["evaluation"]["correction"];
    expect(Object.keys(correction).sort()).toEqual(["at", "direction", "note"]);
    expect(JSON.stringify(correction)).not.toContain("faculty1");
  });

  it("says nothing on a submission nobody corrected", async () => {
    const { submissionId } = await graded({});
    const { rows } = await db().query<{ result: Record<string, any> }>(
      "select result from submission where id = $1", [submissionId]);
    expect(rows[0]!.result["evaluation"]["correction"]).toBeUndefined();
  });

  it("reaches the view the workspace renders from", async () => {
    const { submissionId, evaluationId } = await graded({ verdict: "fail", score: 29 });
    await overrideBand({ evaluationId, reviewerId: faculty, band: "adequate",
                         note: "Names one gap and one gate." });

    const view = await publicView(submissionId);
    expect(view.correction).toMatchObject({ direction: "raised" });
    expect(view.correction!.note).toBe("Names one gap and one gate.");
  });
});

describe("the readiness signal follows the correction", () => {
  it("raises the competency cell when a fail becomes a pass", async () => {
    const { enrolmentId, evaluationId } = await graded({ verdict: "fail", score: 29 });
    expect(await cells(enrolmentId)).toEqual(["attempted", "attempted"]);

    await overrideBand({ evaluationId, reviewerId: faculty, band: "strong",
                         note: "This answer passes the round." });

    // No hints and inside the call budget, so a pass here is clean.
    expect(await cells(enrolmentId)).toEqual(["clean", "clean"]);
  });

  it("lowers the competency cell when a pass becomes a fail", async () => {
    // The one the one-way merge cannot do. docs/02 section 7 makes transitions
    // one-way so a later scruffy attempt never erases earned evidence, and that
    // rule would also make an over-generous grade permanent in the signal the
    // placement side reads. A recompute settles both: the cell is the best of
    // what this learner actually has, not the best it ever briefly showed.
    const { enrolmentId, evaluationId } = await graded({ verdict: "pass", score: 90,
      rubric: { status: "pass", score: 90, threshold: 65 } });
    expect(await cells(enrolmentId)).toEqual(["clean", "clean"]);

    await overrideBand({ evaluationId, reviewerId: faculty, band: "weak",
                         note: "Right headings, no argument under them." });

    expect(await cells(enrolmentId)).toEqual(["attempted", "attempted"]);
  });

  it("takes the best of what a learner has, whatever order it arrived in", () => {
    // Pure, and deliberately not driven through the database: the query that
    // feeds this has no `order by`, so a test going through Postgres would be
    // pinning the planner rather than the rule.
    const pass = { verdict: "pass", hintsUsed: 0, llmCalls: 1, callBudget: 6 };
    const fail = { verdict: "fail", hintsUsed: 0, llmCalls: 1, callBudget: 6 };

    expect(bestStates([{ key: "a", ...fail }, { key: "a", ...pass }]).get("a")).toBe("clean");
    expect(bestStates([{ key: "a", ...pass }, { key: "a", ...fail }]).get("a")).toBe("clean");
    // A hinted pass is progress and is not evidence, so it never displaces a
    // clean one however late it lands.
    expect(bestStates([
      { key: "a", ...pass },
      { key: "a", verdict: "pass", hintsUsed: 3, llmCalls: 1, callBudget: 6 },
    ]).get("a")).toBe("clean");
    // A verdict that says nothing about the learner contributes nothing.
    expect(bestStates([{ key: "a", verdict: "error", hintsUsed: 0,
                         llmCalls: null, callBudget: 6 }]).has("a")).toBe(false);
  });

  it("recomputes across every submission a learner has", async () => {
    // A recompute rebuilds every cell from scratch, so the order submissions
    // arrived in must not decide the answer. Without this the first failing
    // attempt would pin the cell at `attempted` for good.
    const first = await graded({ slug: "harden-the-leaky-prompt", verdict: "fail", score: 30,
      probes: { status: "fail", passed: 1, total: 3, cases: [] },
      rubric: { status: "fail", score: 30, threshold: 65 } });
    await graded({ slug: "harden-the-leaky-prompt", verdict: "pass", score: 80,
      enrolmentId: first.enrolmentId,
      probes: { status: "pass", passed: 3, total: 3, cases: [] },
      rubric: { status: "pass", score: 80, threshold: 65 } });
    const design = await graded({ verdict: "fail", score: 29,
      enrolmentId: first.enrolmentId });

    await overrideBand({ evaluationId: design.evaluationId, reviewerId: faculty,
                         band: "strong", note: "The design answer is strong." });

    // By competency rather than by difficulty: what is being asserted is that
    // the prompt problem's cells survived, and the lint rule is right that a
    // difficulty comparison here would drift the first time a tier moves.
    const after = await heatmapFor(db(), first.enrolmentId);
    const prompt = after.filter((row) =>
      row.slug === "prompt-hardening" || row.slug === "prompt-construction");
    expect(prompt).toHaveLength(2);
    expect(prompt.every((row) => row.state === "clean")).toBe(true);
    // And the design problem's own cells came up with the override.
    const design2 = after.filter((row) => row.slug === "evaluation-design");
    expect(design2.every((row) => row.state === "clean")).toBe(true);
  });

  it("passes a design answer at adequate, which is where the pass mark is", async () => {
    // The boundary band, and the only one worth pinning: the judge takes its
    // threshold from the exemplar the author labelled `adequate`, so adequate
    // is the pass mark by construction rather than by a number anybody chose.
    const { submissionId, enrolmentId, evaluationId } = await graded(
      { verdict: "fail", score: 29 });

    await overrideBand({ evaluationId, reviewerId: faculty, band: "adequate",
                         note: "Names one gap and one gate, and concedes the date." });

    const { rows } = await db().query<{ verdict: string }>(
      "select verdict::text from submission where id = $1", [submissionId]);
    expect(rows[0]!.verdict).toBe("pass");
    expect(await cells(enrolmentId)).toEqual(["clean", "clean"]);
  });

  it("keeps a cell another submission still earns", async () => {
    // A recompute reads every submission, so downgrading one does not erase
    // what a different problem carrying the same competency already proved.
    const { enrolmentId, evaluationId } = await graded({ verdict: "pass", score: 90,
      rubric: { status: "pass", score: 90, threshold: 65 } });
    const before = await heatmapFor(db(), enrolmentId);
    expect(before.every((row) => row.state === "clean")).toBe(true);

    // A second passing submission on another problem sharing a competency.
    const second = await createSubmission({
      enrolmentId, cohortId,
      problemId: await problemId("harden-the-leaky-prompt"), kind: "submit",
      body: "A hardened prompt.",
    });
    await dispatchOnce();
    const [message] = await receive("judgements", 1);
    await writeResult({
      submission_id: second.id,
      lease_token: String(message!.body["lease_token"]),
      fencing_token: Number(message!.body["fencing_token"]),
      body_sha256: second.bodySha256,
      result: {
        verdict: "pass", score: 80,
        gates: { static: { status: "pass", checks: [] },
                 probes: { status: "pass", passed: 3, total: 3, cases: [] },
                 rubric: { status: "pass", score: 80, threshold: 65 } },
        budget: { llm_calls: 1, tool_calls: 0, wall_ms: 900 },
        trace: { submission_id: 0, steps: [], flags: [] },
      },
    });

    await overrideBand({ evaluationId, reviewerId: faculty, band: "weak",
                         note: "The design answer is weak." });

    const after = await heatmapFor(db(), enrolmentId);
    // The competency the prompt problem also carries survives; the one only the
    // design problem carried comes down.
    const byKey = new Map(after.map((r) => [`${r.slug}/${r.difficulty}`, r.state]));
    expect([...byKey.values()].some((state) => state === "clean")).toBe(true);
    expect([...byKey.values()].some((state) => state === "attempted")).toBe(true);
  });
});

describe("what an override costs the person making it", () => {
  it("refuses one with nothing written in it", async () => {
    const { evaluationId } = await graded({});
    await expect(overrideBand({ evaluationId, reviewerId: faculty, band: "strong", note: " " }))
      .rejects.toBeInstanceOf(NoteRequired);
  });

  it("refuses a band that is not a band", async () => {
    const { evaluationId } = await graded({});
    await expect(overrideBand({ evaluationId, reviewerId: faculty,
                                band: "excellent" as never, note: "A note." }))
      .rejects.toBeInstanceOf(UnknownBand);
  });

  it("refuses an evaluation that does not exist", async () => {
    await expect(overrideBand({ evaluationId: 99_999, reviewerId: faculty,
                                band: "strong", note: "A note." }))
      .rejects.toBeInstanceOf(NotOverridable);
  });

  it("refuses an errored evaluation, which has no grade to correct", async () => {
    // An error verdict consumes nothing and means nothing about the learner.
    // Overriding it would invent a grade for a submission that never ran.
    const { submissionId, evaluationId } = await graded({});
    await db().query("update evaluation set state = 'error', verdict = null, score = null " +
                     "where id = $1", [evaluationId]);
    await expect(overrideBand({ evaluationId, reviewerId: faculty, band: "strong",
                                note: "A note." })).rejects.toBeInstanceOf(NotOverridable);
    expect(submissionId).toBeGreaterThan(0);
  });

  it("writes an audit row naming the band it moved from and to", async () => {
    const { evaluationId } = await graded({});

    await overrideBand({ evaluationId, reviewerId: faculty, band: "strong",
                         note: "Raised after reading it against the exemplars." });

    const { rows } = await db().query<{ action: string; detail: Record<string, unknown> }>(
      "select action, detail from audit_log where actor_id = $1 and action = $2",
      [faculty, "evaluation.override"]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.detail).toMatchObject({ from: "weak", to: "strong" });
  });
});
