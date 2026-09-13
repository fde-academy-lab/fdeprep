/**
 * The local stand-in for SQS.
 *
 * The real queue is infrastructure a human deploys. This gives the dispatcher,
 * the runner and the result writer the same at-least-once delivery with a
 * visibility timeout to build against, so the code that uses a queue does not
 * change when the queue becomes SQS.
 */
import { db } from "../db/pool.ts";

export type QueueName = "submissions" | "results";

export interface QueueMessage {
  id: number;
  body: Record<string, unknown>;
  received: number;
}

const VISIBILITY_TIMEOUT_S = 60;

export async function send(queue: QueueName, body: Record<string, unknown>): Promise<number> {
  const { rows } = await db().query<{ id: string }>(
    "insert into queue_message (queue, body) values ($1, $2) returning id",
    [queue, JSON.stringify(body)]);
  return Number(rows[0]!.id);
}

/**
 * Claim up to `max` visible messages. Delivery is at-least-once: a consumer
 * that dies without deleting sees the message again after the timeout, which
 * is why the result writer dedupes on the fencing token rather than assuming
 * it is called once.
 */
export async function receive(queue: QueueName, max = 10): Promise<QueueMessage[]> {
  const { rows } = await db().query<{ id: string; body: Record<string, unknown>; received: number }>(
    `update queue_message set
       visible_at = now() + make_interval(secs => $3),
       received = received + 1
     where id in (
       select id from queue_message
        where queue = $1 and deleted_at is null and visible_at <= now()
        order by id
        for update skip locked
        limit $2)
     returning id, body, received`,
    [queue, max, VISIBILITY_TIMEOUT_S]);
  return rows.map((row) => ({ id: Number(row.id), body: row.body, received: row.received }));
}

export async function deleteMessage(id: number): Promise<void> {
  await db().query("update queue_message set deleted_at = now() where id = $1", [id]);
}

export async function depth(queue: QueueName): Promise<number> {
  const { rows } = await db().query<{ count: string }>(
    "select count(*) from queue_message where queue = $1 and deleted_at is null", [queue]);
  return Number(rows[0]!.count);
}
