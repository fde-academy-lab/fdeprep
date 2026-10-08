/**
 * Running the panel again on a graded submission. docs/10 sections 9 and 10.
 *
 * Two callers, one set of rules. The judge worker's drain finishes a partial
 * evaluation the platform owes, and the regrade command grades a submission
 * again under the judge prompt that replaced the one that graded it (S15.3,
 * call C5). Either way:
 *
 * A new evaluation is appended. No row is edited or deleted, so what the panel
 * said before stays readable for an appeal.
 *
 * The terminal verdict stands. Panelist 1 is rebuilt from the committed result
 * with the committed verdict, so a re-run can move a band and never a verdict:
 * only deterministic checks produce a terminal verdict.
 *
 * No allowance moves. This file writes `evaluation`, the evaluation block of
 * the result contract and, for a regrade, an audit row. Nothing here counts or
 * refunds an attempt.
 *
 * It appends only on top of the evaluation it read. The submission row is
 * locked and the newest evaluation compared before the insert, so two workers
 * draining one backlog, or a regrade racing the drain, cannot both write.
 *
 * Nothing in this file reads its own path, so a page can import it.
 */
import type { Pool, PoolClient } from "pg";
import { parse } from "yaml";
import { db, inTransaction } from "../db/pool.ts";
import { isComplexity, type Complexity } from "../policy/complexity.ts";
import type { Embed } from "./embed.ts";
import {
  complexityOf, judgePromptOf, llmPanelist, pretrainedFor, rubricScore, staticPanelist,
  type ResultContract,
} from "./from-result.ts";
import { runPanel, type Panelist, type PanelistName, type PanelInput } from "./panel.ts";
import type { Evaluation } from "./consolidate.ts";
import { rememberGraded } from "./pretrained.ts";
import {
  latestEvaluation, learnerFacing, saveEvaluation, type StoredEvaluation,
} from "./record.ts";

/**
 * Asks the judge to grade a submission's answer again and returns its whole
 * response. The queue side supplies it (lib/queue/judge-worker.ts, rejudge),
 * so eval/ never holds a road to the judge of its own.
 */
export type Rejudge = (submissionId: number) => Promise<Record<string, unknown>>;

export type UnchangedCode =
  /** The newest evaluation is no longer the one this read. */
  | "changed"
  /** There is nothing here a re-run may touch. */
  | "not_eligible"
  /** A panelist is still missing, so a re-run would be partial again. */
  | "still_partial"
  /** The judge did not grade the answer. */
  | "judge_failed"
  /** The judge graded with a prompt other than the one the caller expected. */
  | "prompt_mismatch";

export type ReevaluationOutcome =
  | { status: "written"; evaluationId: number; previous: StoredEvaluation;
      evaluation: StoredEvaluation }
  | { status: "unchanged"; code: UnchangedCode; reason: string };

interface Graded {
  submissionId: number;
  enrolmentId: number | null;
  problemId: number;
  slug: string;
  artefactType: string;
  verdict: string | null;
  body: string;
  sourceYaml: string;
  callBudget: number | null;
  contract: ResultContract | null;
  newest: StoredEvaluation | null;
}

/** A submission a re-run may build on: graded, with a result and an evaluation. */
interface Ready extends Graded {
  verdict: "pass" | "fail";
  contract: ResultContract;
  newest: StoredEvaluation;
}

type Seat = Evaluation["panel"][number];

export interface DrainOptions {
  /** How to reach the judge when the record holds no score to read. */
  rejudge?: Rejudge;
  /** Panelist 2's encoder. Tests pass a stub. */
  embed?: Embed;
}

/**
 * Re-run a partial evaluation: the free re-run docs/10 section 9 promises.
 *
 * Only the seats that could not run are asked again. A seat that ran, or that
 * this deployment does not have, is carried across as it was, so a re-run
 * costs what the outage cost and no more. Panelist 3 reads the judgement
 * already on the record first, because the judge may have answered and the
 * panel failed to read it (from-result.ts, rubricScore), and asks the judge
 * only when the record holds no score.
 *
 * Only a complete evaluation is appended. A re-run that would still be partial
 * writes nothing, so one outage is one partial row for as long as it lasts, and
 * the partial rate analytics/ reports counts outages rather than retries. The
 * caller decides when to try again.
 */
export async function reevaluatePartial(
  submissionId: number,
  options: DrainOptions = {},
): Promise<ReevaluationOutcome> {
  const graded = ready(await loadGraded(submissionId));
  if (typeof graded === "string") return unchanged("not_eligible", graded);
  const previous = graded.newest;
  if (previous.state !== "partial") {
    return unchanged("not_eligible", "its newest evaluation is not partial, so no re-run is owed");
  }

  const p2 = seatOf(previous, "pretrained")?.status === "unavailable"
    ? pretrainedFor({
        problemId: graded.problemId, sourceYaml: graded.sourceYaml, client: db(),
        embed: options.embed, excludeSubmissionId: submissionId,
      })
    : replay("pretrained", seatOf(previous, "pretrained"));

  let p3 = replay("llm", seatOf(previous, "llm"));
  if (seatOf(previous, "llm")?.status === "unavailable") {
    if (rubricScore(graded.contract, graded.artefactType) !== null) {
      p3 = llmPanelist(graded.contract);
    } else if (options.rejudge) {
      p3 = judgedBy(await ask(options.rejudge, submissionId), graded.artefactType);
    }
  }

  const evaluation = await runPanel(inputFor(graded, previous), [terminal(graded), p2, p3]);
  if (evaluation.state !== "complete") {
    const missing = evaluation.panel
      .filter((seat) => seat.status === "unavailable")
      .map((seat) => `${seat.panelist} (${seat.reason ?? "unavailable"})`);
    return unchanged("still_partial", `still waiting on ${missing.join(" and ")}`);
  }
  return append(graded, previous, evaluation, options.embed, null);
}

export interface RegradeOptions {
  rejudge: Rejudge;
  /** Panelist 2's encoder, used only to file the new band in its pool. */
  embed?: Embed;
  /** The prompt the caller expects the judge to grade with, when it knows one. */
  expect?: string;
}

/**
 * Grade a submission again under a judge prompt other than the one that
 * graded it. S15.3, call C5.
 *
 * Panelist 3 is the only seat asked again, because the prompt is the only
 * thing that changed: panelist 1 is the committed result and panelist 2 is
 * carried across from the evaluation being replaced. The band may move either
 * way, since the newer prompt is the better judge. The terminal verdict does
 * not move.
 *
 * Writes nothing when the judge does not grade, so a submission the judge
 * could not reach keeps the evaluation it had and the next run selects it
 * again.
 */
export async function regradeSubmission(
  target: { submissionId: number; evaluationId: number },
  options: RegradeOptions,
): Promise<ReevaluationOutcome> {
  const graded = ready(await loadGraded(target.submissionId));
  if (typeof graded === "string") return unchanged("not_eligible", graded);
  const previous = graded.newest;

  if (previous.id !== target.evaluationId) {
    return unchanged("changed", "a newer evaluation landed after this run selected it");
  }
  if (previous.state !== "complete") {
    return unchanged("not_eligible",
      `its newest evaluation is ${previous.state}, which the drain finishes before any regrade`);
  }
  if (previous.overriddenBy !== null) {
    return unchanged("not_eligible", "a person set this grade, and a regrade does not overrule one");
  }
  if (seatOf(previous, "llm")?.status !== "ran") {
    return unchanged("not_eligible", "no judge prompt graded it");
  }

  const answer = await ask(options.rejudge, target.submissionId);
  if (!judged(answer.response, graded.artefactType)) {
    return unchanged("judge_failed", `the judge did not grade it: ${answer.reason}`);
  }
  const prompt = judgePromptOf(answer.response!);
  if (!prompt) {
    return unchanged("judge_failed",
      "the judge graded it without naming a prompt, so the record could not say which");
  }
  if (options.expect && prompt !== options.expect) {
    return unchanged("prompt_mismatch",
      `the judge graded with ${prompt}, and this checkout names ${options.expect} as current. ` +
      "Deploy the judge with the new prompt, then run the regrade again.");
  }

  const evaluation = await runPanel(inputFor(graded, previous), [
    terminal(graded), replay("pretrained", seatOf(previous, "pretrained")),
    llmPanelist(answer.response!),
  ]);
  if (evaluation.state !== "complete") {
    return unchanged("still_partial", "the panel could not complete the new evaluation");
  }
  return append(graded, previous, evaluation, options.embed, {
    action: "evaluation.regrade",
    detail: {
      from_prompt: previous.judgePrompt, to_prompt: prompt,
      from_band: previous.band, to_band: evaluation.band,
    },
  });
}

/* ------------------------------------------------------------------ parts */

async function loadGraded(
  submissionId: number, client: Pool | PoolClient = db(),
): Promise<Graded | null> {
  const { rows } = await client.query<{
    artefact_type: string; verdict: string | null; body: string;
    result: ResultContract | null; source_yaml: string; call_budget: string | null;
    problem_id: string; slug: string; enrolment_id: string | null;
  }>(
    `select case when s.kind = 'defence' then 'defence'
                 else p.artefact_type::text end as artefact_type,
            s.verdict::text as verdict, s.body, s.result, v.source_yaml, v.call_budget,
            p.id as problem_id, p.slug, a.enrolment_id
       from submission s
       join problem_version v on v.id = s.problem_version_id
       join problem p on p.id = v.problem_id
       join attempt a on a.id = s.attempt_id
      where s.id = $1`, [submissionId]);
  const row = rows[0];
  if (!row) return null;

  return {
    submissionId,
    enrolmentId: row.enrolment_id === null ? null : Number(row.enrolment_id),
    problemId: Number(row.problem_id),
    slug: row.slug,
    artefactType: row.artefact_type,
    verdict: row.verdict,
    body: row.body,
    sourceYaml: row.source_yaml,
    callBudget: row.call_budget === null ? null : Number(row.call_budget),
    contract: row.result,
    newest: await latestEvaluation(submissionId, client),
  };
}

/** The submission when a re-run may build on it, or the reason it may not. */
function ready(graded: Graded | null): Ready | string {
  if (!graded) return "the submission does not exist";
  if (!graded.newest) return "it has no evaluation to build on";
  if (graded.verdict !== "pass" && graded.verdict !== "fail") {
    return `its verdict is ${graded.verdict ?? "still pending"}, which carries no grade`;
  }
  if (!graded.contract) return "it has no committed result to read";
  return graded as Ready;
}

/**
 * Panelist 1 over the committed result, reporting the committed verdict.
 *
 * The verdict column is the terminal verdict, written once under the lease's
 * compare-and-set, and it is what panelist 1 reports here whatever else the
 * result says.
 */
function terminal(graded: Ready): Panelist {
  return staticPanelist(
    { ...graded.contract, verdict: graded.verdict },
    { sourceYaml: graded.sourceYaml, callBudget: graded.callBudget });
}

function seatOf(evaluation: StoredEvaluation, name: PanelistName): Seat | undefined {
  return evaluation.panel.find((seat) => seat.panelist === name);
}

/** A seat from the evaluation being replaced, reported again as it was. */
function replay(name: PanelistName, seat: Seat | undefined): Panelist {
  return {
    name,
    async run() {
      return seat ?? { status: "skipped", reason: "not_on_the_record", ms: 0, findings: [] };
    },
  };
}

interface Answer {
  response: ResultContract | null;
  reason: string;
}

/** The judge's response, or the reason there is none. Never throws. */
async function ask(rejudge: Rejudge, submissionId: number): Promise<Answer> {
  try {
    const response = await rejudge(submissionId) as ResultContract;
    return { response, reason: String(response["message"] ?? `verdict ${response.verdict}`) };
  } catch (error) {
    return { response: null, reason: (error as Error).message.slice(0, 300) };
  }
}

/** Whether the judge graded the answer: a verdict, and a rubric score to read. */
function judged(response: ResultContract | null, artefactType: string): boolean {
  if (!response) return false;
  return (response.verdict === "pass" || response.verdict === "fail") &&
    rubricScore(response, artefactType) !== null;
}

/**
 * Panelist 3 over a fresh judgement, or unavailable when the judge did not
 * grade. llmPanelist alone would read an error's skipped rubric gate as the
 * cheaper check working, and an outage would pass for a finished evaluation.
 */
function judgedBy(answer: Answer, artefactType: string): Panelist {
  if (judged(answer.response, artefactType)) return llmPanelist(answer.response!);
  return {
    name: "llm",
    async run() {
      return { status: "unavailable", reason: `judge: ${answer.reason}`.slice(0, 200), ms: 0,
               findings: [] };
    },
  };
}

function inputFor(graded: Graded, previous: StoredEvaluation): PanelInput {
  return {
    submissionId: graded.submissionId,
    // The level the evaluation being replaced was graded at. The problem
    // version is fixed per submission, so this is the level it would derive.
    complexity: isComplexity(previous.complexity)
      ? previous.complexity : declaredComplexity(graded),
    artefactType: graded.artefactType,
    body: graded.body,
    problemSlug: graded.slug,
  };
}

function declaredComplexity(graded: Graded): Complexity {
  try {
    const declared = (parse(graded.sourceYaml) as { complexity?: unknown } | null)?.complexity;
    return complexityOf(graded.artefactType, declared);
  } catch {
    return complexityOf(graded.artefactType, undefined);
  }
}

function unchanged(code: UnchangedCode, reason: string): ReevaluationOutcome {
  return { status: "unchanged", code, reason };
}

/**
 * Append the new evaluation on top of the one this read, or write nothing.
 *
 * The result contract's evaluation block and its one voice follow the newest
 * row, as the result writer puts them there for the first, because the
 * contract is what the front end renders from. The verdict, the score and the
 * gates are the committed result and stay exactly as they were.
 */
async function append(
  graded: Graded,
  previous: StoredEvaluation,
  evaluation: Evaluation,
  embed: Embed | undefined,
  audit: { action: string; detail: Record<string, unknown> } | null,
): Promise<ReevaluationOutcome> {
  const written = await inTransaction(async (tx) => {
    await tx.query("select id from submission where id = $1 for update", [graded.submissionId]);
    const newest = await latestEvaluation(graded.submissionId, tx);
    if (newest?.id !== previous.id) return null;

    const evaluationId = await saveEvaluation(evaluation, graded.enrolmentId, tx);
    const saved = (await latestEvaluation(graded.submissionId, tx))!;

    const shown = learnerFacing(saved);
    await tx.query(
      "update submission set result = result || $2::jsonb where id = $1 and result is not null",
      [graded.submissionId,
       JSON.stringify({ feedback_md: shown.feedback_md, evaluation: shown.evaluation })]);

    if (audit) {
      await tx.query(
        `insert into audit_log (actor_id, action, target, detail)
         values (null, $1, $2, $3)`,
        [audit.action, `evaluation:${previous.id}`,
         JSON.stringify({ ...audit.detail, evaluation_id: evaluationId })]);
    }
    return { evaluationId, saved };
  });

  if (!written) {
    return unchanged("changed", "a newer evaluation landed while this one was being graded");
  }

  // docs/10 section 5: the pool holds each graded answer once, with the band
  // the panel settled on, and that band is now this one. Best effort and
  // outside the transaction: an encoder that cannot run leaves the older band
  // in the pool, which costs panelist 2 a little precision and the learner
  // nothing, and an evaluation already committed is not worth undoing for it.
  if (written.saved.band) {
    try {
      await rememberGraded(db(), {
        problemId: graded.problemId, submissionId: graded.submissionId,
        band: written.saved.band, body: graded.body,
      }, embed);
    } catch {
      // The evaluation stands; see above.
    }
  }

  return { status: "written", evaluationId: written.evaluationId, previous,
           evaluation: written.saved };
}
