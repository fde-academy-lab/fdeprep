/**
 * The result writer.
 *
 * This is the only component that turns a submission terminal, and it does so
 * with the compare-and-set docs/03 section 9.3 requires: the update applies
 * only when the lease token, the fencing token and the body hash all still
 * match and no verdict has landed. A late or duplicated runner therefore
 * cannot overwrite a fresh result or revive a cancelled submission.
 */
import { inTransaction } from "../db/pool.ts";
import { applyForSubmission } from "../competency/score.ts";
import { refund } from "../policy/caps.ts";

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
    const gates = (message.result["gates"] ?? {}) as Record<string, any>;
    const budget = (message.result["budget"] ?? {}) as Record<string, any>;
    const verdict = String(message.result["verdict"] ?? "error");

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
        message.submission_id, verdict, JSON.stringify(message.result),
        message.result["score"] ?? null,
        gates["public"]?.passed ?? null, gates["public"]?.total ?? null,
        gates["hidden"]?.passed ?? null, gates["hidden"]?.total ?? null,
        gates["adversarial"]?.passed ?? null, gates["adversarial"]?.total ?? null,
        budget["llm_calls"] ?? null, budget["tool_calls"] ?? null, budget["wall_ms"] ?? null,
        message.result["trace_ref"] ?? null,
        message.lease_token, message.fencing_token, message.body_sha256,
      ]);

    if (!rows.length) return false;

    // docs/03 section 8: infrastructure failures are the platform's problem.
    if (verdict === "error" || verdict === "timeout") {
      await refund(client, message.submission_id);
    }

    // docs/02 section 7: transitions are computed on every finished
    // submission, not only on a pass, because attempted is a state too.
    await applyForSubmission(client, message.submission_id);

    if (verdict === "pass") {
      await client.query(
        `update attempt a set solved_at = coalesce(a.solved_at, now())
           from submission s where s.id = $1 and s.attempt_id = a.id and s.kind = 'submit'`,
        [message.submission_id]);
    }

    await client.query(
      `insert into runner_event (submission_id, level, message, detail)
       values ($1, 'info', 'result committed', $2)`,
      [message.submission_id, JSON.stringify({ verdict, fencing_token: message.fencing_token })]);

    return true;
  });
}
