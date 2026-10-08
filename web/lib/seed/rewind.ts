/**
 * Moving rows back in time without touching a grade.
 *
 * The seed writes each simulated day's rows now, through the production write
 * paths, and then moves their timestamps back to that day. This is the only
 * place in the seed that sets a timestamp by hand, and it can only name the
 * columns below. Every one is a moment; none is a verdict, a score, a band or
 * a state. A rewind naming any other column does not compile.
 *
 * The first column of each table is when its row was born, which is how
 * rewindWindow tells a row written in the window from an older row that only
 * had one moment set in it, such as an attempt solved today and opened a week
 * ago.
 */
import type { Pool, PoolClient } from "pg";

export const REWIND = {
  submission: ["queued_at", "started_at", "finished_at", "lease_expires_at"],
  attempt: ["first_opened_at", "solved_at", "gave_up_at"],
  evaluation: ["created_at"],
  evaluation_review: ["created_at", "updated_at"],
  hint_reveal: ["revealed_at"],
  voice_session: ["started_at", "finished_at", "scored_at"],
  voice_consent: ["granted_at"],
  rehearsal: ["started_at", "ends_at", "finished_at"],
  rate_limit_counter: ["window_start"],
  audit_log: ["created_at"],
  runner_event: ["created_at"],
  invite: ["created_at", "expires_at", "used_at"],
  enrolment: ["joined_at"],
  app_user: ["created_at", "last_seen_at"],
  persona_change: ["changed_at"],
  platform_setting: ["updated_at"],
} as const;

export type RewindTable = keyof typeof REWIND;
export type RewindColumn<T extends RewindTable> = (typeof REWIND)[T][number];

/** A moment from Postgres as text, so microseconds survive the round trip. */
export type Moment = string;

export async function now(client: Pool | PoolClient): Promise<Moment> {
  const { rows } = await client.query<{ at: string }>("select clock_timestamp()::text as at");
  return rows[0]!.at;
}

const BACK = "- $3::double precision * interval '1 millisecond'";

/**
 * Move every allowlisted moment written between `from` and `to` back by `ms`.
 *
 * A row born in the window moves whole, future moments included: a lease
 * that expires two minutes after it was taken still expires two minutes after
 * it was taken. A row born earlier moves only the moments set in the window.
 */
export async function rewindWindow(
  client: Pool | PoolClient, window: { from: Moment; to: Moment }, ms: number,
): Promise<void> {
  for (const [table, columns] of Object.entries(REWIND) as Array<[RewindTable, readonly string[]]>) {
    const [birth, ...rest] = columns;
    await client.query(
      `update ${table} set ${columns.map((c) => `${c} = ${c} ${BACK}`).join(", ")}
        where ${birth} >= $1::timestamptz and ${birth} <= $2::timestamptz`,
      [window.from, window.to, ms]);
    for (const column of rest) {
      await client.query(
        `update ${table} set ${column} = ${column} ${BACK}
          where ${column} >= $1::timestamptz and ${column} <= $2::timestamptz
            and ${birth} < $1::timestamptz`,
        [window.from, window.to, ms]);
    }
  }
}

/** Move the named moments of these rows back by `ms`. */
export async function rewindRows<T extends Exclude<RewindTable, "platform_setting">>(
  client: Pool | PoolClient, table: T, ids: readonly number[], ms: number,
  columns: readonly RewindColumn<T>[] = REWIND[table],
): Promise<void> {
  if (!ids.length || !columns.length) return;
  await client.query(
    `update ${table} set ${columns.map((c) => `${c} = ${c} - $1::double precision * interval '1 millisecond'`).join(", ")}
      where id = any($2::bigint[])`,
    [ms, ids]);
}
