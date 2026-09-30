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
 * organisation, or ending their enrolment, and there is no second user list
 * to keep in step. The one write to the enrolment table here is an invite
 * being redeemed, which is an admin's decision made earlier and spent now.
 *
 * The beta (30 September 2026) can switch the organisation wall off with
 * GITHUB_ORG_CHECK=off. An invite then stands in for it: without one, only
 * someone already enrolled gets in, and a stranger leaves no row.
 */
import type { PoolClient } from "pg";
import { db, inTransaction } from "../db/pool.ts";
import type { GithubViewer } from "./github.ts";
import { orgCheckRequired } from "./config.ts";
import { checkInvite, redeemInvite, type OpenInvite } from "./invite.ts";
import { REFUSALS, type AccessRefusal } from "./refusals.ts";

export type { AccessRefusal } from "./refusals.ts";

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

function refuse(reason: AccessRefusal): AccessRefused {
  return { ok: false, reason, message: REFUSALS[reason] };
}

export interface AccessOptions {
  /** Whether organisation membership is required. Defaults to GITHUB_ORG_CHECK. */
  orgRequired?: boolean;
  /** The token from an invite link, carried through GitHub in a cookie. */
  inviteToken?: string | null;
}

class InviteLost extends Error {
  constructor(readonly reason: AccessRefusal) {
    super(reason);
  }
}

export async function resolveAccess(
  viewer: GithubViewer,
  isMember: boolean,
  options: AccessOptions = {},
): Promise<AccessGranted | AccessRefused> {
  const orgRequired = options.orgRequired ?? orgCheckRequired();

  // Every refusal that can be decided without writing is decided here, before
  // the upsert, so somebody turned away leaves no trace. An app_user row for a
  // person who cannot sign in is a record of a stranger knocking, and the
  // roster is meant to be the list of who is here.
  if (orgRequired && !isMember) return refuse("not_a_member");

  const pool = db();
  let invite: OpenInvite | null = null;
  if (options.inviteToken) {
    const checked = await checkInvite(options.inviteToken, viewer.login);
    if (!checked.ok) return refuse(checked.reason);
    invite = checked.invite;
  } else if (!orgRequired) {
    // No organisation wall and no invite: only somebody already here is let
    // through to the enrolment check below.
    const { rows } = await pool.query("select 1 from app_user where github_id = $1", [viewer.id]);
    if (!rows.length) return refuse("not_enrolled");
  }

  let userId: number;
  try {
    userId = invite
      // The upsert and the spend share a transaction, so a person who loses a
      // race for the link is rolled back to no row at all.
      ? await inTransaction(async (client) => {
          const id = await upsertUser(client, viewer);
          const redeemed = await redeemInvite(client, invite, { id, login: viewer.login });
          if (!redeemed.ok) throw new InviteLost(redeemed.reason);
          return id;
        })
      : await upsertUser(pool, viewer);
  } catch (error) {
    if (error instanceof InviteLost) return refuse(error.reason);
    throw error;
  }

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
    displayName: viewer.name?.trim() || viewer.login,
  };
}

async function upsertUser(
  client: PoolClient | ReturnType<typeof db>, viewer: GithubViewer,
): Promise<number> {
  const displayName = viewer.name?.trim() || viewer.login;
  const { rows } = await client.query<{ id: string }>(
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
  return Number(rows[0]!.id);
}
