/**
 * The dispatcher from docs/03 section 9.2, steps 2 and 3.
 *
 * It reads unsent outbox rows, claims the submission with a lease and a
 * fencing token, publishes, and marks the row sent. Re-delivery is expected,
 * so the runner deduplicates on submission id and the result writer refuses a
 * result whose fencing token is not the current one.
 */
import { randomUUID } from "node:crypto";
import { db, inTransaction } from "../db/pool.ts";
import { send } from "./shim.ts";

const LEASE_SECONDS = 120;

export async function dispatchOnce(batch = 20): Promise<number> {
  const { rows } = await db().query<{ id: string; submission_id: string; payload: Record<string, unknown> }>(
    `select id, submission_id, payload from outbox
      where sent_at is null order by created_at limit $1`, [batch]);

  let sent = 0;
  for (const row of rows) {
    try {
      await publishOne(Number(row.id), Number(row.submission_id), row.payload);
      sent += 1;
    } catch (error) {
      await db().query(
        `update outbox set attempts = attempts + 1, last_error = $2 where id = $1`,
        [row.id, (error as Error).message]);
    }
  }
  return sent;
}

async function publishOne(
  outboxId: number, submissionId: number, payload: Record<string, unknown>,
): Promise<void> {
  await inTransaction(async (client) => {
    // Claim inside the same transaction that marks the outbox row sent, so a
    // crash between the two cannot leave a claimed submission with no message.
    const leaseToken = randomUUID();
    const { rows } = await client.query<{ fencing_token: string; body_sha256: string }>(
      `update submission
          set status = 'running',
              lease_token = $2,
              fencing_token = nextval('fencing_token_seq'),
              lease_expires_at = now() + make_interval(secs => $3),
              started_at = coalesce(started_at, now())
        where id = $1 and verdict is null
        returning fencing_token, body_sha256`,
      [submissionId, leaseToken, LEASE_SECONDS]);

    const claim = rows[0];
    if (!claim) {
      // Already terminal, usually because a retry arrived after the result.
      await client.query("update outbox set sent_at = now() where id = $1", [outboxId]);
      return;
    }

    await client.query("update outbox set sent_at = now() where id = $1", [outboxId]);
    await send("submissions", {
      ...payload,
      submission_id: submissionId,
      lease_token: leaseToken,
      fencing_token: Number(claim.fencing_token),
      body_sha256: claim.body_sha256,
    });
  });
}

/**
 * docs/03 section 9.3: a scheduled job expires abandoned leases and marks
 * orphaned submissions error, which under section 8 does not consume an
 * allowance.
 */
export async function reapExpiredLeases(): Promise<number> {
  const { rows } = await db().query<{ id: string }>(
    `update submission
        set status = 'terminal', verdict = 'error', finished_at = now(),
            result = jsonb_build_object(
              'verdict', 'error',
              'message', 'The runner stopped responding. Your attempt was not counted.',
              'consumes_allowance', false)
      where verdict is null and lease_expires_at is not null and lease_expires_at < now()
      returning id`);
  return rows.length;
}
