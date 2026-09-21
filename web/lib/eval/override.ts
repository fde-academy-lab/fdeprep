/**
 * The faculty override. docs/00 section 3.1, docs/10 sections 9.7 and 13.
 *
 * The disagreement queue lets faculty say a grade is wrong. This lets them fix
 * it. Without both halves a wrong grade a human has already identified and
 * cannot change sits in the record, which is worse than not knowing about it.
 *
 * Three rules shape everything here.
 *
 * An override writes a new evaluation rather than editing one. The table is
 * append-only, and an appeal has to be able to read what the panel said before
 * a human disagreed with it.
 *
 * It does not go through `saveEvaluation`. That function floors a score at the
 * partial it replaces, because the platform finishing its own work may never
 * cost a learner points. A human saying an answer was graded too generously is
 * exactly the opposite case, and the floor would silently swallow it.
 *
 * It recomputes the competency cells rather than merging into them, because the
 * merge is one-way and a correction that can only raise a grade cannot correct
 * an over-generous one.
 */
import type { Pool, PoolClient } from "pg";
import { inTransaction } from "../db/pool.ts";
import { recomputeForEnrolment } from "../competency/score.ts";
import { BANDS, bandScore, type Band } from "../policy/bands.ts";
import type { Evaluation } from "./consolidate.ts";
import { latestEvaluation } from "./record.ts";

export class NoteRequired extends Error {
  readonly status = 400;
  constructor() {
    super("Overriding a grade needs a note saying what the answer does and why " +
          "the panel was wrong. A learner may ask, and this is the answer.");
    this.name = "NoteRequired";
  }
}

export class UnknownBand extends Error {
  readonly status = 400;
  constructor(given: string) {
    super(`"${given}" is not a band. Use strong, adequate, weak or off_question.`);
    this.name = "UnknownBand";
  }
}

export class NotOverridable extends Error {
  readonly status = 404;
  constructor(message: string) {
    super(message);
    this.name = "NotOverridable";
  }
}

export interface OverrideInput {
  /** The evaluation being corrected, which stays on the record unchanged. */
  evaluationId: number;
  reviewerId: number;
  band: Band;
  note: string;
}

/**
 * A design answer passes at `adequate` or better.
 *
 * This is the judge's own rule rather than a new one: `pass_threshold` in
 * judge/handler.py takes the threshold from the exemplar the author labelled
 * `adequate`, so that band is the pass mark by construction. Expressing it in
 * bands rather than comparing `bandScore` to the stored threshold avoids a
 * boundary that lands the wrong way, since the adequate median measured across
 * the content is 63 and a given problem's adequate exemplar may be 65.
 */
const PASSING: readonly Band[] = ["strong", "adequate"];

export function bandPasses(band: Band): boolean {
  return PASSING.includes(band);
}

/**
 * Whether the rubric is what decided this submission's verdict.
 *
 * judge/handler.py sets `verdict = "pass"` unconditionally once a probe battery
 * has run, and only falls back to the rubric threshold when there are no
 * probes. So a prompt problem's verdict belongs to its probes and a design
 * problem's belongs to its rubric. Overruling a deterministic battery is a
 * different and larger decision than regrading an argument, and this does not
 * make it.
 */
export function rubricDecidesVerdict(contract: Record<string, unknown>): boolean {
  const gates = (contract["gates"] ?? {}) as Record<string, { status?: string }>;
  const probes = gates["probes"]?.status;
  const rubric = gates["rubric"]?.status;
  if (!rubric || rubric === "skipped") return false;
  return !probes || probes === "skipped";
}

/** Returns the id of the new evaluation row. */
export async function overrideBand(
  input: OverrideInput,
  client?: Pool | PoolClient,
): Promise<number> {
  const note = input.note.trim();
  if (!note) throw new NoteRequired();
  if (!BANDS.includes(input.band)) throw new UnknownBand(String(input.band));

  const run = async (tx: PoolClient): Promise<number> => {
    const { rows } = await tx.query<{
      submission_id: string; enrolment_id: string | null; complexity: string;
      state: string; band: string | null; panel: Evaluation["panel"];
      result: Record<string, unknown> | null;
    }>(
      `select e.submission_id, e.enrolment_id, e.complexity, e.state::text, e.band,
              e.panel, s.result
         from evaluation e join submission s on s.id = e.submission_id
        where e.id = $1`, [input.evaluationId]);

    const row = rows[0];
    if (!row) throw new NotOverridable(`Evaluation ${input.evaluationId} does not exist.`);
    if (row.state === "error") {
      throw new NotOverridable(
        `Evaluation ${input.evaluationId} is an error, so there is no grade to correct. ` +
        "An error consumes no allowance and says nothing about the learner.");
    }

    const submissionId = Number(row.submission_id);
    const contract = row.result ?? {};
    const score = bandScore(input.band);
    const verdict = rubricDecidesVerdict(contract)
      ? (bandPasses(input.band) ? "pass" : "fail")
      : null;

    // A new row rather than an edit, and written here rather than through
    // saveEvaluation so the rise-only floor does not apply. See the module note.
    const inserted = await tx.query<{ id: string }>(
      `insert into evaluation
         (submission_id, enrolment_id, complexity, state, verdict, score,
          score_provisional, confidence, band, panel, disagreement, feedback_md,
          overridden_by, override_note)
       select $1, e.enrolment_id, e.complexity, 'complete',
              coalesce($2::verdict, e.verdict), $3, false, 'high', $4,
              $5::jsonb, null, e.feedback_md, $6, $7
         from evaluation e where e.id = $8
       returning id`,
      [submissionId, verdict, score, input.band,
       JSON.stringify(withFaculty(row.panel, input.band)),
       input.reviewerId, note, input.evaluationId]);
    const evaluationId = Number(inserted.rows[0]!.id);

    // The submission is what the learner actually reads a score from, so an
    // override that stopped at the evaluation would be invisible to them.
    const { rows: updated } = await tx.query<{ verdict: string }>(
      `update submission set score = $2,
              verdict = coalesce($3::verdict, verdict)
        where id = $1 returning verdict::text`,
      [submissionId, score, verdict]);

    // The disagreement is settled, so the contract's evaluation block says so.
    // No panelist name and no reviewer name reaches it: docs/10 section 10
    // keeps provenance on the record and out of the learner's reading.
    if (row.result) {
      await tx.query("update submission set result = $2 where id = $1",
        [submissionId, JSON.stringify({
          ...contract,
          evaluation: { state: "complete", confidence: "high", provisional: false },
        })]);
    }

    // docs/02 section 7: the heatmap is the readiness signal, and a corrected
    // grade that left it alone would make the signal disagree with the record.
    if (row.enrolment_id) {
      await recomputeForEnrolment(tx, Number(row.enrolment_id));
    }

    await tx.query(
      `insert into audit_log (actor_id, action, target, detail)
       values ($1, 'evaluation.override', $2, $3)`,
      [input.reviewerId, `evaluation:${input.evaluationId}`,
       JSON.stringify({
         from: row.band, to: input.band, score,
         verdict: updated[0]?.verdict ?? null, note,
       })]);

    return evaluationId;
  };

  if (client) return run(client as PoolClient);
  return inTransaction(run);
}

/**
 * The panel, with the person who settled it added as a seat.
 *
 * The automated panelists stay exactly as they were, because an appeal needs to
 * read what each of them said before a human disagreed. Panelist provenance is
 * faculty-only either way, so this adds a name to a record the learner never
 * sees.
 */
function withFaculty(panel: Evaluation["panel"], band: Band): Evaluation["panel"] {
  return [
    ...panel.filter((seat) => seat.panelist !== "faculty"),
    { panelist: "faculty", status: "ran", ms: 0, findings: [], band },
  ];
}

export { latestEvaluation };
