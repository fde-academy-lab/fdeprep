/**
 * The consent gate. docs/07 section 9.
 *
 * "No session starts without a `voice_consent` row." That sentence is the
 * whole module: one place that answers whether a row exists, one place that
 * writes it, and a refusal every start path goes through.
 */
import { db } from "../db/pool.ts";

export class ConsentRequired extends Error {
  readonly status = 403;
  constructor() {
    super(
      "Recording needs your consent first. Read what is recorded and for how long, " +
        "then accept, and you will not be asked again.",
    );
  }
}

export type ConsentState = { granted: boolean; grantedAt: Date | null };

export async function consentState(enrolmentId: number): Promise<ConsentState> {
  const { rows } = await db().query<{ granted_at: Date; revoked_at: Date | null }>(
    "select granted_at, revoked_at from voice_consent where enrolment_id = $1",
    [enrolmentId],
  );
  const row = rows[0];
  if (!row || row.revoked_at) return { granted: false, grantedAt: null };
  return { granted: true, grantedAt: row.granted_at };
}

/**
 * docs/07 section 12, item 1: a learner grants consent once and never sees
 * the screen again. A second grant is the same row, re-dated and un-revoked,
 * rather than a second row, which is what the unique constraint on
 * enrolment_id is for.
 */
export async function grantConsent(enrolmentId: number): Promise<ConsentState> {
  const { rows } = await db().query<{ granted_at: Date }>(
    `insert into voice_consent (enrolment_id) values ($1)
     on conflict (enrolment_id)
       do update set granted_at = now(), revoked_at = null
     returning granted_at`,
    [enrolmentId],
  );
  return { granted: true, grantedAt: rows[0]!.granted_at };
}

/** Withdrawing consent stops future sessions. It does not delete recordings;
 *  docs/07 section 9 gives that its own button, because a learner who wants
 *  one does not always want the other. */
export async function revokeConsent(enrolmentId: number): Promise<void> {
  await db().query("update voice_consent set revoked_at = now() where enrolment_id = $1", [
    enrolmentId,
  ]);
}

export async function requireConsent(enrolmentId: number): Promise<void> {
  if (!(await consentState(enrolmentId)).granted) throw new ConsentRequired();
}
