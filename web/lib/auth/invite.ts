/**
 * Invites, for a beta whose testers hold GitHub accounts outside the
 * organisation. docs/00 section 2 and docs/02, amended 30 September 2026.
 *
 * An admin creates an invite and sends the link by hand. Whoever redeems it
 * through the GitHub sign-in is enrolled in the invite's cohort with its role
 * and persona, and the link is spent. Three rules hold throughout:
 *
 * - the database holds a SHA-256 of the token and never the token, so a copy
 *   of the table lets nobody in;
 * - the spend is one conditional update, so two people racing a link cannot
 *   both win;
 * - every check that can refuse runs before anything is written, so a
 *   stranger who is turned away leaves no row behind.
 */
import { createHash, randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { db, inTransaction } from "../db/pool.ts";
import type { AccessRefusal } from "./refusals.ts";

export type InviteRole = "learner" | "faculty" | "admin";
export type InvitePersona = "builder" | "navigator" | "accelerator";
export type InviteState = "pending" | "used" | "expired" | "withdrawn";

const ROLES: readonly InviteRole[] = ["learner", "faculty", "admin"];
const PERSONAS: readonly InvitePersona[] = ["builder", "navigator", "accelerator"];

/** 32 random bytes in base64url is 43 characters. Anything else is not ours. */
export const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/** GitHub's own rule for a login: letters, digits and single hyphens, at most 39. */
const LOGIN_SHAPE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

export const DEFAULT_EXPIRY_DAYS = 14;
const MAX_EXPIRY_DAYS = 90;
const MAX_NOTE = 200;

export class InviteInvalid extends Error {
  readonly status = 400;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface CreateInviteInput {
  cohortId: number;
  /** Null only for an invite minted on the host, before any admin exists. */
  actorId: number | null;
  role?: InviteRole;
  persona?: InvitePersona;
  /** When set, only this GitHub login may redeem the invite. */
  githubLogin?: string | null;
  note?: string | null;
  expiresInDays?: number;
}

export interface CreatedInvite {
  id: number;
  /** Shown once, at creation, and never stored. */
  token: string;
  expiresAt: string;
}

export async function createInvite(input: CreateInviteInput): Promise<CreatedInvite> {
  const role = input.role ?? "learner";
  const persona = input.persona ?? "navigator";
  if (!ROLES.includes(role)) throw new InviteInvalid(`"${role}" is not a role.`);
  if (!PERSONAS.includes(persona)) throw new InviteInvalid(`"${persona}" is not a persona.`);

  const login = input.githubLogin?.trim().replace(/^@/, "") || null;
  if (login && !LOGIN_SHAPE.test(login)) {
    throw new InviteInvalid(`"${login}" is not a GitHub login. Leave it empty to let anyone ` +
                            "with the link redeem it.");
  }
  const note = input.note?.trim().slice(0, MAX_NOTE) || null;
  const days = input.expiresInDays ?? DEFAULT_EXPIRY_DAYS;
  if (!Number.isInteger(days) || days < 1 || days > MAX_EXPIRY_DAYS) {
    throw new InviteInvalid(`An invite lasts between 1 and ${MAX_EXPIRY_DAYS} days.`);
  }

  const token = randomBytes(32).toString("base64url");
  return inTransaction(async (client) => {
    const { rows } = await client.query<{ id: string; expires_at: Date }>(
      `insert into invite (token_sha256, cohort_id, role, persona, github_login, note,
                           created_by, expires_at)
       values ($1, $2, $3::app_role, $4::persona, $5, $6, $7, now() + make_interval(days => $8))
       returning id, expires_at`,
      [hashToken(token), input.cohortId, role, persona, login, note, input.actorId, days]);
    const id = Number(rows[0]!.id);
    await audit(client, input.actorId, "invite_created", id,
      { cohort_id: input.cohortId, role, persona, github_login: login, note,
        expires_at: rows[0]!.expires_at });
    return { id, token, expiresAt: rows[0]!.expires_at.toISOString() };
  });
}

/**
 * The first invite, minted on the host by `npm run invite`.
 *
 * With the organisation check off, nobody can sign in without an invite, and
 * invites are made on an admin screen, so the first admin needs a way in that
 * does not start from a browser. Whoever can run this already holds the
 * database credential, so it asks for nothing more. It makes the cohort if the
 * slug is new, and the audit row names no actor, which is how an operator
 * reading the log later can tell this invite from the ones admins made.
 */
export async function mintInviteOnHost(input: {
  cohortSlug: string;
  cohortName?: string;
  role?: InviteRole;
  persona?: InvitePersona;
  githubLogin?: string | null;
  expiresInDays?: number;
}): Promise<CreatedInvite & { cohortId: number }> {
  const slug = input.cohortSlug.trim();
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(slug)) {
    throw new InviteInvalid(`"${slug}" is not a cohort slug. Use lower case letters, digits ` +
                            "and hyphens, such as pilot-1.");
  }
  const { rows } = await db().query<{ id: string }>(
    `insert into cohort (slug, name, starts_on) values ($1, $2, current_date)
     on conflict (slug) do update set slug = excluded.slug
     returning id`,
    [slug, input.cohortName?.trim() || slug]);
  const cohortId = Number(rows[0]!.id);
  const created = await createInvite({
    cohortId, actorId: null, role: input.role ?? "admin", persona: input.persona,
    githubLogin: input.githubLogin, expiresInDays: input.expiresInDays,
    note: "minted on the host",
  });
  return { ...created, cohortId };
}

/** Withdraw an invite nobody has used yet. Returns false when there was nothing to withdraw. */
export async function revokeInvite(id: number, actorId: number): Promise<boolean> {
  return inTransaction(async (client) => {
    const { rows } = await client.query(
      `update invite set revoked_at = now()
        where id = $1 and used_at is null and revoked_at is null
        returning id`, [id]);
    if (!rows.length) return false;
    await audit(client, actorId, "invite_revoked", id, {});
    return true;
  });
}

export interface InviteRow {
  id: number;
  note: string | null;
  githubLogin: string | null;
  role: InviteRole;
  persona: InvitePersona;
  state: InviteState;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  usedByLogin: string | null;
}

export async function listInvites(cohortId: number): Promise<InviteRow[]> {
  const { rows } = await db().query<{
    id: string; note: string | null; github_login: string | null; role: InviteRole;
    persona: InvitePersona; state: InviteState; created_at: Date; expires_at: Date;
    used_at: Date | null; used_by_login: string | null;
  }>(
    `select i.id, i.note, i.github_login, i.role::text as role, i.persona::text as persona,
            case when i.used_at is not null then 'used'
                 when i.revoked_at is not null then 'withdrawn'
                 when i.expires_at <= now() then 'expired'
                 else 'pending' end as state,
            i.created_at, i.expires_at, i.used_at, u.github_login as used_by_login
       from invite i left join app_user u on u.id = i.used_by
      where i.cohort_id = $1
      order by i.created_at desc, i.id desc`, [cohortId]);
  return rows.map((row) => ({
    id: Number(row.id),
    note: row.note,
    githubLogin: row.github_login,
    role: row.role,
    persona: row.persona,
    state: row.state,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    usedAt: row.used_at?.toISOString() ?? null,
    usedByLogin: row.used_by_login,
  }));
}

/**
 * Whether a link can still be redeemed, for the page someone lands on before
 * signing in. It says no more than the link's holder is owed: open, spent, or
 * no longer valid.
 */
export async function inviteStatus(token: string): Promise<"open" | "used" | "invalid"> {
  if (!TOKEN_SHAPE.test(token)) return "invalid";
  const { rows } = await db().query<{ used: boolean; valid: boolean }>(
    `select used_at is not null as used,
            revoked_at is null and expires_at > now() as valid
       from invite where token_sha256 = $1`, [hashToken(token)]);
  const row = rows[0];
  if (!row) return "invalid";
  if (row.used) return "used";
  return row.valid ? "open" : "invalid";
}

export interface OpenInvite {
  tokenSha256: string;
}

/**
 * Check a token before anything is written. The refusal reasons are the ones
 * the sign-in screen explains. This only reads, so a refused stranger leaves
 * no trace; the spend itself happens in redeemInvite, which re-checks.
 */
export async function checkInvite(
  token: string, login: string, client: Pool | PoolClient = db(),
): Promise<{ ok: true; invite: OpenInvite } | { ok: false; reason: AccessRefusal }> {
  if (!TOKEN_SHAPE.test(token)) return { ok: false, reason: "invite_invalid" };
  const tokenSha256 = hashToken(token);
  const { rows } = await client.query<{
    used: boolean; valid: boolean; github_login: string | null;
  }>(
    `select used_at is not null as used,
            revoked_at is null and expires_at > now() as valid,
            github_login
       from invite where token_sha256 = $1`, [tokenSha256]);
  const row = rows[0];
  if (!row) return { ok: false, reason: "invite_invalid" };
  if (row.used) return { ok: false, reason: "invite_used" };
  if (!row.valid) return { ok: false, reason: "invite_invalid" };
  if (row.github_login && row.github_login.toLowerCase() !== login.toLowerCase()) {
    return { ok: false, reason: "invite_other_account" };
  }
  return { ok: true, invite: { tokenSha256 } };
}

/**
 * Spend the invite and enrol the user, inside the caller's transaction.
 *
 * The update is conditional on every check checkInvite made, so it is the
 * spend that decides a race: the second transaction to reach it updates no
 * row and is refused, and its caller rolls back whatever it wrote first.
 */
export async function redeemInvite(
  client: PoolClient, invite: OpenInvite, user: { id: number; login: string },
): Promise<{ ok: true; enrolmentId: number } | { ok: false; reason: AccessRefusal }> {
  const { rows } = await client.query<{
    id: string; cohort_id: string; role: InviteRole; persona: InvitePersona;
  }>(
    `update invite set used_at = now(), used_by = $2
      where token_sha256 = $1
        and used_at is null and revoked_at is null and expires_at > now()
        and (github_login is null or lower(github_login) = lower($3))
      returning id, cohort_id, role::text as role, persona::text as persona`,
    [invite.tokenSha256, user.id, user.login]);
  const spent = rows[0];
  if (!spent) return { ok: false, reason: "invite_used" };

  // A fresh invite brings back someone whose enrolment in this cohort ended,
  // with the role and persona the new invite names.
  const enrolment = await client.query<{ id: string }>(
    `insert into enrolment (user_id, cohort_id, role, persona, state)
     values ($1, $2, $3::app_role, $4::persona, 'active')
     on conflict (user_id, cohort_id) do update
       set role = excluded.role, persona = excluded.persona, state = 'active'
     returning id`,
    [user.id, spent.cohort_id, spent.role, spent.persona]);
  await audit(client, user.id, "invite_redeemed", Number(spent.id),
    { cohort_id: Number(spent.cohort_id), role: spent.role, persona: spent.persona });
  return { ok: true, enrolmentId: Number(enrolment.rows[0]!.id) };
}

async function audit(
  client: Pool | PoolClient, actorId: number | null, action: string, inviteId: number,
  detail: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `insert into audit_log (actor_id, action, target, detail) values ($1, $2, $3, $4)`,
    [actorId, action, `invite:${inviteId}`, JSON.stringify(detail)]);
}
