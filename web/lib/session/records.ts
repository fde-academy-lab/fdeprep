/**
 * Whose work a signed-in person may open. docs/00 section 2, with the cohort
 * as the boundary.
 *
 * A learner opens their own work. Faculty open the work of anyone enrolled in
 * their own cohort, and an admin opens any cohort's. Nobody else opens
 * anything, whatever number they put in an address.
 *
 * Each lookup below answers null both when the record does not exist and when
 * the viewer may not open it, so a route that turns null into its not-found
 * answers the two the same way, and a learner counting through ids learns
 * nothing, including which ids are taken.
 *
 * The viewer always comes from the signed cookie, resolved by
 * lib/session/current.ts. Nothing here reads an enrolment, a cohort or a role
 * from the request: .claude/rules/01, client input is never authoritative.
 * This module reads the record's owner and decides; the caller loads the
 * record itself only after this says yes (S15.13).
 */
import { db } from "../db/pool.ts";
import type { Learner } from "./current.ts";

export type Viewer = Pick<Learner, "enrolmentId" | "cohortId" | "role">;

/** The enrolment a record belongs to, and that enrolment's cohort. */
export interface Owner {
  enrolmentId: number;
  cohortId: number;
}

/** The rule on its own, so who may read what is testable without a database. */
export function mayRead(viewer: Viewer, owner: Owner): boolean {
  if (owner.enrolmentId === viewer.enrolmentId) return true;
  if (viewer.role === "admin") return true;
  return viewer.role === "faculty" && owner.cohortId === viewer.cohortId;
}

/**
 * The cohort a staff list is limited to: the viewer's own, or null for an
 * admin, who reads every cohort. The Submissions browser and the disagreement
 * queue pass this to their query.
 */
export function staffCohort(viewer: Viewer): number | null {
  return viewer.role === "admin" ? null : viewer.cohortId;
}

/** The owner of whichever row the query finds, or null for an id that is not one. */
async function ownerOf(sql: string, id: number): Promise<Owner | null> {
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const { rows } = await db().query<{ enrolment_id: string; cohort_id: string }>(sql, [id]);
  const row = rows[0];
  return row ? { enrolmentId: Number(row.enrolment_id), cohortId: Number(row.cohort_id) } : null;
}

// The owner is the enrolment the work was done under, and its cohort is that
// enrolment's, so a learner carried into a new cohort leaves their old work
// with the faculty who taught it.
const SUBMISSION_OWNER = `
  select e.id as enrolment_id, e.cohort_id
    from submission s
    join attempt a on a.id = s.attempt_id
    join enrolment e on e.id = a.enrolment_id
   where s.id = $1`;

const VOICE_SESSION_OWNER = `
  select e.id as enrolment_id, e.cohort_id
    from voice_session s
    join enrolment e on e.id = s.enrolment_id
   where s.id = $1`;

// Through the submission rather than evaluation.enrolment_id, which may be null.
const EVALUATION_OWNER = `
  select e.id as enrolment_id, e.cohort_id
    from evaluation v
    join submission s on s.id = v.submission_id
    join attempt a on a.id = s.attempt_id
    join enrolment e on e.id = a.enrolment_id
   where v.id = $1`;

/** A submission's owner, when the viewer may read the submission, its events and its trace. */
export async function readableSubmission(viewer: Viewer, submissionId: number): Promise<Owner | null> {
  const owner = await ownerOf(SUBMISSION_OWNER, submissionId);
  return owner && mayRead(viewer, owner) ? owner : null;
}

/**
 * A voice session's owner, when the viewer may read its debrief. Hearing the
 * recording also needs the learner's share for anyone but the learner
 * (docs/07 section 9), which lib/voice/audio.ts decides.
 */
export async function readableVoiceSession(viewer: Viewer, sessionId: number): Promise<Owner | null> {
  const owner = await ownerOf(VOICE_SESSION_OWNER, sessionId);
  return owner && mayRead(viewer, owner) ? owner : null;
}

/**
 * A voice session's owner, when the viewer is that owner. Saving an answer,
 * storing or deleting its recording and sharing it are the learner's alone,
 * and staff who may read the session still may not change it.
 */
export async function ownVoiceSession(viewer: Viewer, sessionId: number): Promise<Owner | null> {
  const owner = await ownerOf(VOICE_SESSION_OWNER, sessionId);
  return owner && owner.enrolmentId === viewer.enrolmentId ? owner : null;
}

/** The owner of the submission an evaluation grades, when the viewer may read it. */
export async function readableEvaluation(viewer: Viewer, evaluationId: number): Promise<Owner | null> {
  const owner = await ownerOf(EVALUATION_OWNER, evaluationId);
  return owner && mayRead(viewer, owner) ? owner : null;
}
