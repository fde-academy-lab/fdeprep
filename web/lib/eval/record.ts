/**
 * Writing and reading the evaluation record, and splitting what the learner
 * sees from what faculty see. docs/10 sections 10 and 7.
 *
 * `eval/` is the only writer of a grade. `progress/` and `analytics/` read this
 * table and never recompute, which is the rule that makes a heatmap
 * disagreeing with a report card structurally impossible rather than a bug
 * somebody has to find.
 */
import type { Pool, PoolClient } from "pg";
import { db } from "../db/pool.ts";
import type { Band } from "../policy/bands.ts";
import type { Complexity } from "../policy/complexity.ts";
import type { Confidence, Disagreement, Evaluation, EvaluationState } from "./consolidate.ts";

export type { Evaluation } from "./consolidate.ts";

export interface StoredEvaluation {
  id: number;
  submissionId: number;
  complexity: Complexity;
  state: EvaluationState;
  verdict: "pass" | "fail" | null;
  score: number | null;
  scoreProvisional: boolean;
  confidence: Confidence;
  band: Band | null;
  panel: Evaluation["panel"];
  disagreement: Disagreement | null;
  feedbackMd: string;
  createdAt: string;
}

/**
 * What the front end renders. docs/10 section 10.
 *
 * No panelist name, no reason a panelist gave for being unavailable, no band
 * attribution. A learner should hear one reviewer, the way an interviewer
 * sounds, and the provenance that an appeal needs stays on the record.
 */
export interface LearnerFacing {
  verdict: "pass" | "fail" | null;
  score: number | null;
  feedback_md: string;
  evaluation: {
    state: EvaluationState;
    confidence: Confidence;
    provisional: boolean;
  };
}

export function learnerFacing(evaluation: Evaluation | StoredEvaluation): LearnerFacing {
  return {
    verdict: evaluation.verdict,
    score: evaluation.score,
    feedback_md: evaluation.feedbackMd,
    evaluation: {
      state: evaluation.state,
      confidence: evaluation.confidence,
      provisional: evaluation.scoreProvisional,
    },
  };
}

/**
 * Append an evaluation, never update one.
 *
 * The one adjustment made on the way in: a completed re-evaluation is floored
 * at the provisional score it replaces. docs/10 section 9 promises the score
 * moves upward or stays equal, and without the floor a learner who saw 65
 * during an outage could see 35 an hour later through no fault of their own.
 * The platform owed them the review; it does not get to charge them for it.
 */
export async function saveEvaluation(
  evaluation: Evaluation,
  enrolmentId: number | null = null,
  client: Pool | PoolClient = db(),
): Promise<number> {
  let score = evaluation.score;

  if (evaluation.state === "complete" && score !== null) {
    const previous = await latestEvaluation(evaluation.submissionId, client);
    if (previous?.state === "partial" && previous.score !== null) {
      score = Math.max(score, previous.score);
    }
  }

  const { rows } = await client.query<{ id: string }>(
    `insert into evaluation
       (submission_id, enrolment_id, complexity, state, verdict, score,
        score_provisional, confidence, band, panel, disagreement, feedback_md)
     values ($1, $2, $3, $4::evaluation_state, $5::verdict, $6, $7,
             $8::panel_confidence, $9, $10, $11, $12)
     returning id`,
    [
      evaluation.submissionId, enrolmentId, evaluation.complexity, evaluation.state,
      evaluation.verdict, score, evaluation.scoreProvisional, evaluation.confidence,
      evaluation.band, JSON.stringify(evaluation.panel),
      evaluation.disagreement ? JSON.stringify(evaluation.disagreement) : null,
      evaluation.feedbackMd,
    ]);

  return Number(rows[0]!.id);
}

/** The newest row wins, which is how a re-evaluation supersedes a partial. */
export async function latestEvaluation(
  submissionId: number,
  client: Pool | PoolClient = db(),
): Promise<StoredEvaluation | null> {
  const { rows } = await client.query<{
    id: string; submission_id: string; complexity: string; state: EvaluationState;
    verdict: "pass" | "fail" | null; score: string | null; score_provisional: boolean;
    confidence: Confidence; band: Band | null; panel: Evaluation["panel"];
    disagreement: Disagreement | null; feedback_md: string; created_at: Date;
  }>(
    `select * from evaluation where submission_id = $1
      order by created_at desc, id desc limit 1`, [submissionId]);

  const row = rows[0];
  if (!row) return null;

  return {
    id: Number(row.id),
    submissionId: Number(row.submission_id),
    complexity: row.complexity as Complexity,
    state: row.state,
    verdict: row.verdict,
    score: row.score === null ? null : Number(row.score),
    scoreProvisional: row.score_provisional,
    confidence: row.confidence,
    band: row.band,
    panel: row.panel,
    disagreement: row.disagreement,
    feedbackMd: row.feedback_md,
    createdAt: row.created_at.toISOString(),
  };
}

/**
 * Submissions whose evaluation is still partial, oldest first.
 *
 * A partial evaluation is a promise to the learner, and a promise nobody
 * drains is worse than a plain failure because the learner is still waiting.
 * `analytics/` reports the depth of this list and the worker works it.
 */
export async function reevaluationBacklog(
  limit = 50,
  client: Pool | PoolClient = db(),
): Promise<number[]> {
  // Only the newest row per submission counts, because a completed re-run
  // supersedes the partial that preceded it. Filtering before the distinct
  // would return every submission that was ever partial, including the ones
  // already paid off.
  const { rows } = await client.query<{ submission_id: string }>(
    `select submission_id from (
       select distinct on (submission_id) submission_id, state, created_at
         from evaluation
        order by submission_id, created_at desc, id desc
     ) newest
      where state = 'partial'
      order by created_at
      limit $1`, [limit]);
  return rows.map((r) => Number(r.submission_id));
}
