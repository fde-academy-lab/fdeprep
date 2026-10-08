/**
 * Every evaluation one submission has, newest first, as faculty read them.
 * S15.3, docs/10 sections 7 and 10.
 *
 * The table is append-only, so a submission graded, re-run after an outage,
 * regraded under a new prompt and then corrected by a person has four rows,
 * and an appeal needs every one: what the panel said before each change, which
 * judge prompt graded each, and who on the panel said what.
 *
 * That is provenance, and it stays here. The learner reads the newest row only,
 * in one voice, through the result contract.
 */
import type { Pool, PoolClient } from "pg";
import { db } from "../db/pool.ts";
import type { Band } from "../policy/bands.ts";
import type { Complexity } from "../policy/complexity.ts";
import type { Confidence, Evaluation, EvaluationState } from "./consolidate.ts";
import type { PanelistName } from "./panel.ts";

export interface HistorySeat {
  panelist: PanelistName;
  status: "ran" | "unavailable" | "skipped";
  band: Band | null;
  /** Why it did not run, in the panel's own words. */
  reason: string | null;
}

export interface HistoryRow {
  id: number;
  createdAt: string;
  state: EvaluationState;
  verdict: "pass" | "fail" | null;
  score: number | null;
  provisional: boolean;
  confidence: Confidence;
  complexity: Complexity;
  band: Band | null;
  /** The judge prompt that graded it, or null where none is recorded. */
  judgePrompt: string | null;
  /** Whether a judge prompt graded it at all: panelist 3 ran. */
  judged: boolean;
  seats: HistorySeat[];
  disagreement: boolean;
  override: { by: string; note: string } | null;
  /** The row the learner's result follows. */
  newest: boolean;
}

export interface SubmissionRecord {
  submission: {
    id: number;
    login: string;
    title: string;
    slug: string;
    kind: string;
    verdict: string | null;
    score: number | null;
  };
  evaluations: HistoryRow[];
}

export async function evaluationHistory(
  submissionId: number,
  client: Pool | PoolClient = db(),
): Promise<SubmissionRecord | null> {
  const { rows: found } = await client.query<{
    id: string; login: string; title: string; slug: string; kind: string;
    verdict: string | null; score: string | null;
  }>(
    `select s.id, u.github_login as login, p.title, p.slug, s.kind::text as kind,
            s.verdict::text as verdict, s.score
       from submission s
       join attempt a         on a.id = s.attempt_id
       join enrolment en      on en.id = a.enrolment_id
       join app_user u        on u.id = en.user_id
       join problem_version v on v.id = s.problem_version_id
       join problem p         on p.id = v.problem_id
      where s.id = $1`, [submissionId]);
  const submission = found[0];
  if (!submission) return null;

  const { rows } = await client.query<{
    id: string; created_at: Date; state: EvaluationState; verdict: "pass" | "fail" | null;
    score: string | null; score_provisional: boolean; confidence: Confidence;
    complexity: string; band: Band | null; judge_prompt: string | null;
    panel: Evaluation["panel"]; disagreement: unknown; reviewer: string | null;
    override_note: string | null;
  }>(
    `select e.id, e.created_at, e.state, e.verdict::text as verdict, e.score,
            e.score_provisional, e.confidence, e.complexity, e.band, e.judge_prompt,
            e.panel, e.disagreement, reviewer.github_login as reviewer, e.override_note
       from evaluation e
       left join app_user reviewer on reviewer.id = e.overridden_by
      where e.submission_id = $1
      order by e.created_at desc, e.id desc`, [submissionId]);

  return {
    submission: {
      id: Number(submission.id),
      login: submission.login,
      title: submission.title,
      slug: submission.slug,
      kind: submission.kind,
      verdict: submission.verdict,
      score: submission.score === null ? null : Number(submission.score),
    },
    evaluations: rows.map((row, index) => ({
      id: Number(row.id),
      createdAt: row.created_at.toISOString(),
      state: row.state,
      verdict: row.verdict,
      score: row.score === null ? null : Number(row.score),
      provisional: row.score_provisional,
      confidence: row.confidence,
      complexity: row.complexity as Complexity,
      band: row.band,
      judgePrompt: row.judge_prompt,
      judged: (row.panel ?? []).some((seat) => seat.panelist === "llm" && seat.status === "ran"),
      seats: (row.panel ?? []).map((seat) => ({
        panelist: seat.panelist,
        status: seat.status,
        band: seat.band ?? null,
        reason: seat.reason ?? null,
      })),
      disagreement: row.disagreement !== null,
      override: row.override_note !== null
        ? { by: row.reviewer ?? "unknown", note: row.override_note }
        : null,
      newest: index === 0,
    })),
  };
}
