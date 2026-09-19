/**
 * From a GitHub identity to an enrolment, or to one of three refusals.
 *
 * docs/01 section S1 fixes the order and the wording: organisation membership
 * first, then roster presence. The messages are part of the contract because
 * the three failures have three different owners. Not in the organisation is
 * the programme manager's to fix, not on a roster is the cohort lead's, and an
 * ended enrolment is nobody's, it is just true.
 *
 * docs/00 section 2: offboarding a learner is removing them from the GitHub
 * organisation, and there is no second user list to keep in step. So this
 * never writes to the enrolment table. It reads.
 */
import { db } from "../db/pool.ts";
import type { GithubViewer } from "./github.ts";

export type AccessRefusal = "not_a_member" | "not_enrolled" | "enrolment_ended";

export interface AccessGranted {
  ok: true;
  userId: number;
  enrolmentId: number;
  cohortId: number;
  role: "learner" | "faculty" | "admin";
  persona: "builder" | "navigator" | "accelerator";
  displayName: string;
}

export interface AccessRefused {
  ok: false;
  reason: AccessRefusal;
  message: string;
}

const REFUSALS: Record<AccessRefusal, string> = {
  not_a_member: "Your GitHub account is not in the FDE Academy organisation yet.",
  not_enrolled: "Your account is not enrolled in an active cohort.",
  enrolment_ended: "Your enrolment has ended. Past submissions stay readable for thirty days.",
};

function refuse(reason: AccessRefusal): AccessRefused {
  return { ok: false, reason, message: REFUSALS[reason] };
}

export async function resolveAccess(
  viewer: GithubViewer,
  isMember: boolean,
): Promise<AccessGranted | AccessRefused> {
  // Before the upsert, so somebody outside the organisation leaves no trace.
  // An app_user row for a person who cannot sign in is a record of a stranger
  // knocking, and the roster is meant to be the list of who is here.
  if (!isMember) return refuse("not_a_member");

  const pool = db();
  const displayName = viewer.name?.trim() || viewer.login;
  const { rows: users } = await pool.query<{ id: string }>(
    `insert into app_user (github_id, github_login, display_name, avatar_url, email, last_seen_at)
     values ($1, $2, $3, $4, $5, now())
     on conflict (github_id) do update
       set github_login = excluded.github_login,
           display_name = excluded.display_name,
           avatar_url   = excluded.avatar_url,
           email        = coalesce(excluded.email, app_user.email),
           last_seen_at = now()
     returning id`,
    [viewer.id, viewer.login, displayName, viewer.avatarUrl, viewer.email]);
  const userId = Number(users[0]!.id);

  // The newest active enrolment wins, so a learner carried into a second
  // cohort lands in the current one rather than the one they finished.
  const { rows } = await pool.query<{
    id: string; cohort_id: string; role: AccessGranted["role"];
    persona: AccessGranted["persona"]; state: string;
  }>(
    `select id, cohort_id, role::text as role, persona::text as persona, state::text as state
       from enrolment
      where user_id = $1
      order by (state = 'active') desc, id desc
      limit 1`,
    [userId]);

  const enrolment = rows[0];
  if (!enrolment) return refuse("not_enrolled");
  // The enum carries paused as well as ended. docs/01 defines three refusals
  // and no fourth message, and a paused enrolment is not a learner's to fix
  // any more than an ended one is, so both take the same wording.
  if (enrolment.state !== "active") return refuse("enrolment_ended");

  return {
    ok: true,
    userId,
    enrolmentId: Number(enrolment.id),
    cohortId: Number(enrolment.cohort_id),
    role: enrolment.role,
    persona: enrolment.persona,
    displayName,
  };
}
