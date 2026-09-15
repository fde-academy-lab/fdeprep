/**
 * Where a trace lives.
 *
 * docs/03 section 5 puts an S3 URI in `trace_ref`, and section 7 has the runner
 * writing traces to S3. That bucket is infrastructure a human deploys, so this
 * module is the one place that knows where the bytes actually are. The replay
 * viewer asks for a trace by submission and never learns the difference.
 */
import type { Pool, PoolClient } from "pg";
import { db } from "../db/pool.ts";

export interface StoredTrace {
  body: Record<string, unknown>;
  stepCount: number;
  flags: string[];
  truncated: boolean;
}

/** No-op when the result carried no trace, which is every prompt and design submission. */
export async function storeTrace(
  client: Pool | PoolClient, submissionId: number, trace: unknown,
): Promise<boolean> {
  if (!trace || typeof trace !== "object") return false;

  const body = trace as Record<string, unknown>;
  const cases = Array.isArray(body["cases"])
    ? (body["cases"] as Array<Record<string, unknown>>) : [];
  const perCase = cases.map((entry) => (entry["trace"] ?? {}) as Record<string, unknown>);

  const stepCount = perCase.reduce(
    (total, one) => total + (Array.isArray(one["steps"]) ? (one["steps"] as unknown[]).length : 0),
    0);
  const flags = [...new Set(perCase.flatMap(
    (one) => (Array.isArray(one["flags"]) ? (one["flags"] as string[]) : [])))].sort();
  const truncated = perCase.some((one) => one["truncated"] === true);

  await client.query(
    `insert into trace (submission_id, body, step_count, flags, truncated)
     values ($1, $2, $3, $4, $5)
     on conflict (submission_id) do update set
       body = excluded.body, step_count = excluded.step_count,
       flags = excluded.flags, truncated = excluded.truncated`,
    [submissionId, JSON.stringify(body), stepCount, JSON.stringify(flags), truncated]);
  return true;
}

export async function loadTrace(
  submissionId: number, client: Pool | PoolClient = db(),
): Promise<StoredTrace | null> {
  const { rows } = await client.query<{
    body: Record<string, unknown>; step_count: number; flags: string[]; truncated: boolean;
  }>(
    "select body, step_count, flags, truncated from trace where submission_id = $1",
    [submissionId]);
  const row = rows[0];
  if (!row) return null;
  return {
    body: row.body, stepCount: row.step_count, flags: row.flags, truncated: row.truncated,
  };
}
