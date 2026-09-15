/**
 * Runtime switches an operator can throw without a deploy.
 *
 * Degraded mode is the one that matters. docs/05 section 8 names the
 * operations risk plainly: one operator, who is also teaching, and a Tuesday
 * evening where grading stops and 180 learners are blocked. This turns that
 * outage into an inconvenience. Run keeps working, so learners keep iterating
 * against the public tests; Submit closes, so nobody spends a daily Extreme
 * attempt into a queue that is not draining.
 */
import type { Pool, PoolClient } from "pg";
import { db } from "../db/pool.ts";

export const DEGRADED_MODE = "degraded_mode";

export interface DegradedMode {
  on: boolean;
  /** What an operator typed when they threw the switch. */
  reason: string | null;
  since: string | null;
}

/** The message a learner sees where Submit used to be. */
export function degradedMessage(mode: DegradedMode): string {
  const because = mode.reason ? ` ${mode.reason}` : "";
  return `Submit is closed while grading catches up.${because} Run still works, so you can ` +
         "keep testing against the public cases. Nothing has been counted against your " +
         "allowance.";
}

export async function readDegradedMode(
  client: Pool | PoolClient = db(),
): Promise<DegradedMode> {
  const { rows } = await client.query<{ value: unknown; reason: string | null; updated_at: Date }>(
    "select value, reason, updated_at from platform_setting where key = $1", [DEGRADED_MODE]);
  const row = rows[0];
  if (!row) return { on: false, reason: null, since: null };
  return {
    on: row.value === true,
    reason: row.reason,
    since: row.updated_at.toISOString(),
  };
}

/**
 * Throw or clear the switch. The reason is mandatory when turning it on,
 * because the next person to look at the banner is the one who has to decide
 * whether it is still true.
 */
export async function setDegradedMode(
  client: Pool | PoolClient, on: boolean, reason: string | null, actorId: number,
): Promise<void> {
  if (on && !reason?.trim()) {
    throw new Error("Turning on degraded mode needs a reason. It shows on every learner's screen.");
  }
  await client.query(
    `insert into platform_setting (key, value, reason, updated_by, updated_at)
     values ($1, $2::jsonb, $3, $4, now())
     on conflict (key) do update set
       value = excluded.value, reason = excluded.reason,
       updated_by = excluded.updated_by, updated_at = now()`,
    [DEGRADED_MODE, JSON.stringify(on), on ? reason!.trim() : null, actorId]);
}
