/**
 * The faculty disagreement queue. docs/10 section 9.7 and acceptance criterion 7.
 *
 * "The consolidator does not take the mean. It marks `disagreement` on the
 * record, holds the lower band, and surfaces the row to faculty." The first two
 * have been true since the consolidator landed. This is the third, which was
 * computed and stored and rendered nowhere, so the rule that makes holding the
 * lower band survivable did not exist.
 *
 * Written before the implementation. What they describe is a queue that drains:
 * a list showing the same forty rows every week is a list faculty stop opening.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../lib/db/pool.ts";
import { createSubmission } from "../lib/submissions/create.ts";
import { saveEvaluation } from "../lib/eval/record.ts";
import {
  NothingToReview, NoteRequired, disagreementQueue, recordReview,
} from "../lib/eval/review.ts";
import type { Evaluation } from "../lib/eval/consolidate.ts";
import type { Band } from "../lib/policy/bands.ts";
import { permits } from "../lib/admin/guard.ts";
import { importFixtures, resetDatabase, seedLearner } from "./helpers.ts";

let learner: Awaited<ReturnType<typeof seedLearner>>;
let reviewer: number;
let nextLearner = 2;

beforeEach(async () => {
  await resetDatabase();
  await importFixtures();
  learner = await seedLearner();
  nextLearner = 2;
  // The role lives on the enrolment rather than the user, because somebody can
  // be faculty on one cohort and a learner on another.
  const enrolled = await seedLearner({ githubId: 900, login: "faculty1",
                                       cohortId: learner.cohortId });
  await db().query("update enrolment set role = 'faculty' where id = $1",
    [enrolled.enrolmentId]);
  reviewer = enrolled.userId;
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
 * One submission with an evaluation saved against it.
 *
 * A fresh learner each time, because these fixtures are Extreme and the cap is
 * one submit per problem per day, and because a queue of one learner's
 * arguments is not the shape faculty ever sees.
 */
async function evaluated(options: {
  slug?: string;
  bands?: [Band, Band];
  held?: Band;
  createdAt?: string;
} = {}): Promise<{ submissionId: number; evaluationId: number }> {
  const githubId = nextLearner;
  nextLearner += 1;
  const enrolled = await seedLearner({ githubId, cohortId: learner.cohortId });
  const submission = await createSubmission({
    enrolmentId: enrolled.enrolmentId, cohortId: enrolled.cohortId,
    problemId: await problemId(options.slug ?? "argue-the-eval-plan"),
    kind: "submit", body: "An argument about the release threshold.",
  });

  const held = options.held ?? options.bands?.[0] ?? "weak";
  const evaluation: Evaluation = {
    submissionId: submission.id,
    complexity: "C4",
    state: "complete",
    verdict: "pass",
    score: 29,
    scoreProvisional: false,
    confidence: options.bands ? "low" : "high",
    band: held,
    panel: [
      { panelist: "static", status: "ran", ms: 3, findings: [],
        verdict: "pass", scoreContribution: 29 },
      { panelist: "pretrained", status: "ran", ms: 180, findings: [],
        band: options.bands?.[0] ?? "weak" },
      { panelist: "llm", status: "ran", ms: 900, findings: [],
        band: options.bands?.[1] ?? "weak" },
    ],
    disagreement: options.bands ? { bands: options.bands, held } : null,
    feedbackMd: "One voice.",
  };

  const evaluationId = await saveEvaluation(evaluation, enrolled.enrolmentId, db());
  if (options.createdAt) {
    await db().query("update evaluation set created_at = $2 where id = $1",
      [evaluationId, options.createdAt]);
  }
  return { submissionId: submission.id, evaluationId };
}

describe("what reaches the queue", () => {
  it("carries only the evaluations the panel argued about", async () => {
    await evaluated();                                    // agreed, so not faculty's problem
    const argued = await evaluated({ bands: ["weak", "strong"], held: "weak" });

    const queue = await disagreementQueue();

    expect(queue.rows.map((r) => r.evaluationId)).toEqual([argued.evaluationId]);
  });

  it("names both bands, which panelist said each, and which one the learner got", async () => {
    // The whole point of the row. Faculty reading "weak" without knowing the
    // judge said "strong" and an unvalidated panelist pulled it down cannot
    // tell a hard answer from a grading fault.
    await evaluated({ bands: ["weak", "strong"], held: "weak" });

    const [row] = (await disagreementQueue()).rows;

    expect(row!.bands.sort()).toEqual(["strong", "weak"]);
    expect(row!.held).toBe("weak");
    expect(row!.byPanelist).toEqual({ pretrained: "weak", llm: "strong" });
    expect(row!.score).toBe(29);
    expect(row!.login).toMatch(/^learner/);
    expect(row!.slug).toBe("argue-the-eval-plan");
    expect(row!.complexity).toBe("C4");
  });

  it("drops a submission whose re-evaluation stopped disagreeing", async () => {
    // A re-run is a new row and the newest wins. Without the newest-row filter
    // the queue holds arguments that were settled by the platform itself.
    const first = await evaluated({ bands: ["weak", "strong"], held: "weak" });
    const evaluation: Evaluation = {
      submissionId: first.submissionId, complexity: "C4", state: "complete",
      verdict: "pass", score: 90, scoreProvisional: false, confidence: "high",
      band: "strong", panel: [], disagreement: null, feedbackMd: "One voice.",
    };
    await saveEvaluation(evaluation, learner.enrolmentId, db());

    expect((await disagreementQueue()).rows).toEqual([]);
  });

  it("puts the oldest first, because a queue sorted newest first never drains", async () => {
    const old = await evaluated({ bands: ["weak", "strong"],
                                  createdAt: "2026-01-01T09:00:00Z" });
    const recent = await evaluated({ bands: ["weak", "strong"],
                                     createdAt: "2026-06-01T09:00:00Z" });

    const queue = await disagreementQueue();

    expect(queue.rows.map((r) => r.evaluationId))
      .toEqual([old.evaluationId, recent.evaluationId]);
  });
});

describe("the queue drains", () => {
  it("takes a reviewed row out of the open list", async () => {
    const { evaluationId } = await evaluated({ bands: ["weak", "strong"], held: "weak" });

    await recordReview({ evaluationId, reviewerId: reviewer, disposition: "upheld",
                         note: "The answer concedes the date without arguing it." });

    expect((await disagreementQueue()).rows).toEqual([]);
    expect((await disagreementQueue({ disposition: "upheld" })).rows).toHaveLength(1);
    expect((await disagreementQueue({ disposition: "all" })).rows).toHaveLength(1);
  });

  it("keeps the disputed ones findable, since they are the override backlog", async () => {
    // The grade override does not exist yet. Until it does, this list is what
    // somebody works from, so it has to be a list rather than a memory.
    const upheld = await evaluated({ bands: ["weak", "strong"], held: "weak" });
    const disputed = await evaluated({ bands: ["weak", "strong"], held: "weak" });

    await recordReview({ evaluationId: upheld.evaluationId, reviewerId: reviewer,
                         disposition: "upheld", note: "The lower band is right." });
    await recordReview({ evaluationId: disputed.evaluationId, reviewerId: reviewer,
                         disposition: "disputed", note: "This is a strong answer." });

    const queue = await disagreementQueue({ disposition: "disputed" });
    expect(queue.rows.map((r) => r.evaluationId)).toEqual([disputed.evaluationId]);
    expect(queue.rows[0]!.review!.note).toBe("This is a strong answer.");
    expect(queue.rows[0]!.review!.reviewer).toBe("faculty1");
  });

  it("changes a review rather than filing a second one", async () => {
    const { evaluationId } = await evaluated({ bands: ["weak", "strong"], held: "weak" });

    await recordReview({ evaluationId, reviewerId: reviewer, disposition: "upheld",
                         note: "First reading." });
    await recordReview({ evaluationId, reviewerId: reviewer, disposition: "disputed",
                         note: "Second reading, and I was wrong the first time." });

    const { rows } = await db().query<{ count: string }>(
      "select count(*) from evaluation_review where evaluation_id = $1", [evaluationId]);
    expect(Number(rows[0]!.count)).toBe(1);
    const queue = await disagreementQueue({ disposition: "all" });
    expect(queue.rows[0]!.review!.disposition).toBe("disputed");
  });
});

describe("who may settle a disagreement", () => {
  it("lets faculty in and keeps a learner out", () => {
    // docs/01 S10 puts faculty on Submissions in full, and docs/10 section 9.7
    // makes adjudicating a disagreement their job rather than operations': the
    // question is whether an answer was graded correctly.
    expect(permits("faculty", "faculty")).toBe(true);
    expect(permits("admin", "faculty")).toBe(true);
    expect(permits("learner", "faculty")).toBe(false);
  });

  it("does not widen anything else by letting faculty review", () => {
    // Requeueing, counters, the roster and the import screen stay admin only.
    // Adding a faculty level is the kind of change that quietly becomes "or
    // faculty" everywhere, so this is the line that says it did not.
    expect(permits("faculty", "admin")).toBe(false);
    expect(permits("learner", "admin")).toBe(false);
    expect(permits("admin", "admin")).toBe(true);
  });
});

describe("what a review costs the person filing it", () => {
  it("refuses a review with nothing written in it", async () => {
    // Same discipline as every other admin action here: the note is the only
    // record of why, and the person reading it later is not the person who
    // clicked.
    const { evaluationId } = await evaluated({ bands: ["weak", "strong"], held: "weak" });

    await expect(recordReview({ evaluationId, reviewerId: reviewer,
                                disposition: "upheld", note: "   " }))
      .rejects.toBeInstanceOf(NoteRequired);
    expect((await disagreementQueue()).rows).toHaveLength(1);
  });

  it("refuses to review an evaluation the panel agreed on", async () => {
    const { evaluationId } = await evaluated();

    await expect(recordReview({ evaluationId, reviewerId: reviewer,
                                disposition: "upheld", note: "Nothing to see." }))
      .rejects.toBeInstanceOf(NothingToReview);
  });

  it("refuses an evaluation that does not exist", async () => {
    await expect(recordReview({ evaluationId: 99_999, reviewerId: reviewer,
                                disposition: "upheld", note: "A note." }))
      .rejects.toBeInstanceOf(NothingToReview);
  });

  it("leaves the grade exactly where it was", async () => {
    // A review is a reading, not an override. docs/10 section 13: eval/ is the
    // only writer of a grade, and recording that a human disagrees is not one.
    const { submissionId, evaluationId } = await evaluated(
      { bands: ["weak", "strong"], held: "weak" });
    const before = await db().query<{ score: string | null; band: string | null }>(
      "select score, band from evaluation where id = $1", [evaluationId]);
    const beforeSubmission = await db().query<{ score: string | null; verdict: string | null }>(
      "select score, verdict::text from submission where id = $1", [submissionId]);

    await recordReview({ evaluationId, reviewerId: reviewer, disposition: "disputed",
                         note: "The judge was right and the neighbours were not." });

    const after = await db().query<{ score: string | null; band: string | null }>(
      "select score, band from evaluation where id = $1", [evaluationId]);
    expect(after.rows).toEqual(before.rows);
    // And nothing reached the submission either, which is the row the learner
    // actually reads their score from.
    const submission = await db().query<{ score: string | null; verdict: string | null }>(
      "select score, verdict::text from submission where id = $1", [submissionId]);
    expect(submission.rows[0]).toEqual(beforeSubmission.rows[0]);
  });

  it("writes an audit row naming who decided what", async () => {
    const { evaluationId } = await evaluated({ bands: ["weak", "strong"], held: "weak" });

    await recordReview({ evaluationId, reviewerId: reviewer, disposition: "problem_flagged",
                         note: "Two exemplars are nearly the same answer." });

    const { rows } = await db().query<{ action: string; target: string; detail: unknown }>(
      "select action, target, detail from audit_log where actor_id = $1", [reviewer]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe("evaluation.review");
    expect(rows[0]!.target).toBe(`evaluation:${evaluationId}`);
    expect(rows[0]!.detail).toMatchObject({ disposition: "problem_flagged" });
  });
});
