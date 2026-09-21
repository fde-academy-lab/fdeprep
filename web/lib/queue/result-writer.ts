/**
 * The result writer.
 *
 * This is the only component that turns a submission terminal, and it does so
 * with the compare-and-set docs/03 section 9.3 requires: the update applies
 * only when the lease token, the fencing token and the body hash all still
 * match and no verdict has landed. A late or duplicated runner therefore
 * cannot overwrite a fresh result or revive a cancelled submission.
 */
import { parse } from "yaml";
import { inTransaction } from "../db/pool.ts";
import { applyForSubmission } from "../competency/score.ts";
import { complexityOf, panelistsFor } from "../eval/from-result.ts";
import { rememberGraded } from "../eval/pretrained.ts";
import { runPanel } from "../eval/panel.ts";
import { saveEvaluation } from "../eval/record.ts";
import { refund } from "../policy/caps.ts";
import { storeTrace } from "../trace/store.ts";

export interface ResultMessage {
  submission_id: number;
  lease_token: string;
  fencing_token: number;
  body_sha256: string;
  result: Record<string, any>;
}

/** True when the result was committed, false when it lost the compare-and-set. */
export async function writeResult(message: ResultMessage): Promise<boolean> {
  return inTransaction(async (client) => {
    // The trace travels inline in the result because the runner has no S3 in
    // this build. It is split off here so submission.result stays the contract
    // docs/03 section 5 describes, which carries a reference and not a trace.
    const { trace, ...contract } = message.result;

    const gates = (contract["gates"] ?? {}) as Record<string, any>;
    const budget = (contract["budget"] ?? {}) as Record<string, any>;
    const verdict = String(contract["verdict"] ?? "error");

    const { rows } = await client.query<{ id: string }>(
      `update submission set
         status = 'terminal',
         verdict = $2::verdict,
         result = $3,
         score = $4,
         public_passed = $5, public_total = $6,
         hidden_passed = $7, hidden_total = $8,
         adv_passed = $9,    adv_total = $10,
         llm_calls = $11, tool_calls = $12, wall_ms = $13,
         trace_s3_key = $14,
         finished_at = now()
       where id = $1
         and lease_token = $15
         and fencing_token = $16
         and body_sha256 = $17
         and verdict is null
       returning id`,
      [
        message.submission_id, verdict, JSON.stringify(contract),
        contract["score"] ?? null,
        gates["public"]?.passed ?? null, gates["public"]?.total ?? null,
        gates["hidden"]?.passed ?? null, gates["hidden"]?.total ?? null,
        gates["adversarial"]?.passed ?? null, gates["adversarial"]?.total ?? null,
        budget["llm_calls"] ?? null, budget["tool_calls"] ?? null, budget["wall_ms"] ?? null,
        contract["trace_ref"] ?? null,
        message.lease_token, message.fencing_token, message.body_sha256,
      ]);

    if (!rows.length) return false;

    // The trace travels inline in the result because the runner has no S3 in
    // this build. It is lifted out here so submission.result stays the contract
    // docs/03 section 5 describes, which carries a reference and not a trace.
    await storeTrace(client, message.submission_id, trace);

    // docs/03 section 8: infrastructure failures are the platform's problem.
    if (verdict === "error" || verdict === "timeout") {
      await refund(client, message.submission_id);
    }

    // docs/02 section 7: transitions are computed on every finished
    // submission, not only on a pass, because attempted is a state too.
    await applyForSubmission(client, message.submission_id);

    // docs/03 section 4.4: the defence is scored against the attempt, not the
    // problem. The attempt is not complete until it is submitted, so this is
    // the write that completes it.
    if (verdict === "pass" || verdict === "fail") {
      await client.query(
        `update attempt a set defence_body = s.body,
                              defence_score = $2,
                              defence_result = $3
           from submission s
          where s.id = $1 and s.attempt_id = a.id and s.kind = 'defence'`,
        [message.submission_id, contract["score"] ?? null,
         JSON.stringify(contract)]);
    }

    if (verdict === "pass") {
      await client.query(
        `update attempt a set solved_at = coalesce(a.solved_at, now())
           from submission s where s.id = $1 and s.attempt_id = a.id and s.kind = 'submit'`,
        [message.submission_id]);
    }

    // docs/10: the panel reads the gates the runner and the judge already ran
    // and writes one evaluation record. Inside this transaction so the two
    // normally land together, behind a savepoint so a panel failure costs the
    // evaluation and never the verdict.
    await evaluate(client, message.submission_id, contract);

    await client.query(
      `insert into runner_event (submission_id, level, message, detail)
       values ($1, 'info', 'result committed', $2)`,
      [message.submission_id, JSON.stringify({ verdict, fencing_token: message.fencing_token })]);

    return true;
  });
}

/**
 * Run the panel over a finished result and record what it concluded.
 *
 * Wrapped in a savepoint, and that is the whole design of this function. A
 * plain try/catch inside a transaction does not work: the first failing
 * statement aborts the transaction, so the recovery insert fails too and the
 * committed verdict goes with it. The savepoint scopes the failure to the
 * evaluation.
 *
 * The trade this settles: a verdict with no evaluation is recoverable, because
 * the learner still sees a result and `analytics/` reports the gap. An
 * evaluation that takes the verdict down with it leaves a submission that
 * never resolves. The verdict wins.
 */
async function evaluate(
  client: Parameters<typeof storeTrace>[0],
  submissionId: number,
  contract: Record<string, any>,
): Promise<void> {
  await client.query("savepoint panel");
  try {
    const { rows } = await client.query<{
      artefact_type: string; source_yaml: string; enrolment_id: string;
      slug: string; body: string; problem_id: string; call_budget: string | null;
    }>(
      `select case when s.kind = 'defence' then 'defence'
                   else p.artefact_type::text end as artefact_type,
              v.source_yaml, a.enrolment_id, p.slug, s.body, p.id as problem_id,
              v.call_budget
         from submission s
         join problem_version v on v.id = s.problem_version_id
         join problem p on p.id = v.problem_id
         join attempt a on a.id = s.attempt_id
        where s.id = $1`, [submissionId]);

    const row = rows[0];
    if (!row) {
      await client.query("release savepoint panel");
      return;
    }

    // source_yaml is text holding YAML, so the level is parsed here rather
    // than with a JSON operator in the query. The judge worker parses the same
    // column the same way.
    const declared = (parse(row.source_yaml) as { complexity?: unknown } | null)?.complexity;

    const evaluation = await runPanel({
      submissionId,
      complexity: complexityOf(row.artefact_type, declared),
      artefactType: row.artefact_type,
      body: row.body,
      problemSlug: row.slug,
    }, panelistsFor(contract, {
      sourceYaml: row.source_yaml,
      callBudget: row.call_budget === null ? null : Number(row.call_budget),
      pretrained: {
        problemId: Number(row.problem_id),
        sourceYaml: row.source_yaml,
        client,
      },
    }));

    await saveEvaluation(evaluation, Number(row.enrolment_id), client);

    // docs/10 section 5: the pool grows by one row per graded submission, which
    // is how panelist 2 comes to know a cohort without a training run. Only a
    // band the panel actually settled on goes in, because an errored
    // submission is not evidence about anybody.
    if (evaluation.state !== "error") {
      await rememberGraded(client, {
        problemId: Number(row.problem_id),
        submissionId,
        band: evaluation.band,
        body: row.body,
      });
    }

    // The contract is what the front end renders from, so the one voice and
    // the evaluation's state go into it here rather than being fetched
    // separately by a component that would then have two sources for one
    // answer.
    contract["feedback_md"] = evaluation.feedbackMd;
    contract["evaluation"] = {
      state: evaluation.state,
      confidence: evaluation.confidence,
      provisional: evaluation.scoreProvisional,
    };
    await client.query("update submission set result = $2 where id = $1",
      [submissionId, JSON.stringify(contract)]);
    await client.query("release savepoint panel");
  } catch (error) {
    await client.query("rollback to savepoint panel");
    await client.query(
      `insert into runner_event (submission_id, level, message, detail)
       values ($1, 'warn', 'evaluation not recorded', $2)`,
      [submissionId, JSON.stringify({ error: (error as Error).message.slice(0, 500) })]);
  }
}
