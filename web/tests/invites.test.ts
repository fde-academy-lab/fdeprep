/**
 * Invites for a controlled beta, written before the implementation.
 *
 * The beta admits students who hold GitHub accounts but are not in the
 * organisation, so an invite replaces organisation membership as the wall. An
 * invite is a one-time link an admin sends by hand. It enrols whoever redeems
 * it, or only the GitHub login it names, and it can expire or be withdrawn.
 *
 * Three properties matter more than the rest, and each has a test here:
 * - a link works exactly once, even when two people race it;
 * - a stranger who fails any check leaves no row behind;
 * - the database never holds a usable token, only its hash.
 */
import { createHash } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../lib/db/pool.ts";
import { resolveAccess } from "../lib/auth/access.ts";
import { createInvite, listInvites, mintInviteOnHost, revokeInvite } from "../lib/auth/invite.ts";
import { oauthScope, orgCheckRequired } from "../lib/auth/config.ts";
import { resetDatabase, seedLearner } from "./helpers.ts";

const VIEWER = {
  id: 4242, login: "asha", name: "Asha R",
  avatarUrl: "https://avatars.githubusercontent.com/u/4242", email: "asha@example.com",
};
const STRANGER = {
  id: 5151, login: "someone-else", name: "Someone Else",
  avatarUrl: "https://avatars.githubusercontent.com/u/5151", email: null,
};

/** The beta's configuration: no organisation wall, invites instead. */
const BETA = { orgRequired: false } as const;

let admin: Awaited<ReturnType<typeof seedLearner>>;

beforeEach(async () => {
  await resetDatabase();
  admin = await seedLearner({ githubId: 1, login: "the-admin" });
  await db().query("update enrolment set role = 'admin' where id = $1", [admin.enrolmentId]);
});

afterAll(async () => {
  await closeDb();
});

async function usersNamed(login: string): Promise<number> {
  const { rows } = await db().query("select 1 from app_user where github_login = $1", [login]);
  return rows.length;
}

async function invite(extra: Partial<Parameters<typeof createInvite>[0]> = {}) {
  return createInvite({ cohortId: admin.cohortId, actorId: admin.userId, ...extra });
}

describe("redeeming an invite", () => {
  it("lets a GitHub account outside the organisation in, with the invite's role and persona", async () => {
    const { token } = await invite({ persona: "builder", role: "learner" });
    const access = await resolveAccess(VIEWER, false, { ...BETA, inviteToken: token });

    expect(access.ok).toBe(true);
    if (!access.ok) return;
    expect(access.cohortId).toBe(admin.cohortId);
    expect(access.role).toBe("learner");
    expect(access.persona).toBe("builder");

    const { rows } = await db().query<{ used_by: string | null; used_at: Date | null }>(
      "select used_by, used_at from invite");
    expect(Number(rows[0]!.used_by)).toBe(access.userId);
    expect(rows[0]!.used_at).not.toBeNull();
  });

  it("works exactly once", async () => {
    const { token } = await invite();
    expect((await resolveAccess(VIEWER, false, { ...BETA, inviteToken: token })).ok).toBe(true);

    const second = await resolveAccess(STRANGER, false, { ...BETA, inviteToken: token });
    expect(second).toEqual({
      ok: false,
      reason: "invite_used",
      message: "That invite link has already been used. Ask whoever sent it for a new one.",
    });
    expect(await usersNamed(STRANGER.login)).toBe(0);
  });

  it("lets exactly one of two people racing the same link in", async () => {
    const { token } = await invite();
    const results = await Promise.all([
      resolveAccess(VIEWER, false, { ...BETA, inviteToken: token }),
      resolveAccess(STRANGER, false, { ...BETA, inviteToken: token }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const { rows } = await db().query("select 1 from enrolment e join app_user u on u.id = e.user_id " +
      "where u.github_login in ($1, $2)", [VIEWER.login, STRANGER.login]);
    expect(rows).toHaveLength(1);
  });

  it("is not needed again by someone it already let in", async () => {
    const { token } = await invite();
    await resolveAccess(VIEWER, false, { ...BETA, inviteToken: token });
    expect((await resolveAccess(VIEWER, false, BETA)).ok).toBe(true);
  });

  it("refuses an expired invite and leaves no trace of the person", async () => {
    const { token } = await invite();
    await db().query("update invite set expires_at = now() - interval '1 minute'");
    expect(await resolveAccess(VIEWER, false, { ...BETA, inviteToken: token })).toEqual({
      ok: false,
      reason: "invite_invalid",
      message: "That invite link is no longer valid. Ask whoever sent it for a new one.",
    });
    expect(await usersNamed(VIEWER.login)).toBe(0);
  });

  it("refuses a withdrawn invite", async () => {
    const { id, token } = await invite();
    await revokeInvite(id, admin.userId);
    const access = await resolveAccess(VIEWER, false, { ...BETA, inviteToken: token });
    expect(access.ok).toBe(false);
    if (access.ok) return;
    expect(access.reason).toBe("invite_invalid");
  });

  it("refuses a token nobody issued", async () => {
    const access = await resolveAccess(VIEWER, false, { ...BETA, inviteToken: "x".repeat(43) });
    expect(access.ok).toBe(false);
    if (access.ok) return;
    expect(access.reason).toBe("invite_invalid");
    expect(await usersNamed(VIEWER.login)).toBe(0);
  });

  it("admits only the login it names, whatever the case, and stays usable for them", async () => {
    const { token } = await invite({ githubLogin: "Asha" });

    const wrong = await resolveAccess(STRANGER, false, { ...BETA, inviteToken: token });
    expect(wrong).toEqual({
      ok: false,
      reason: "invite_other_account",
      message: "That invite is for a different GitHub account. Sign in with the account it " +
               "was sent to, or ask for a new invite.",
    });
    expect(await usersNamed(STRANGER.login)).toBe(0);

    expect((await resolveAccess(VIEWER, false, { ...BETA, inviteToken: token })).ok).toBe(true);
  });

  it("brings back someone whose enrolment in that cohort had ended", async () => {
    const earlier = await seedLearner({ githubId: VIEWER.id, login: VIEWER.login, cohortId: admin.cohortId });
    await db().query("update enrolment set state = 'ended' where id = $1", [earlier.enrolmentId]);
    const { token } = await invite({ role: "faculty" });

    const access = await resolveAccess(VIEWER, false, { ...BETA, inviteToken: token });
    expect(access.ok).toBe(true);
    if (!access.ok) return;
    expect(access.enrolmentId).toBe(earlier.enrolmentId);
    expect(access.role).toBe("faculty");
  });
});

describe("the organisation wall, now a switch", () => {
  it("with the check off, refuses a stranger with no invite and writes nothing", async () => {
    const access = await resolveAccess(VIEWER, false, BETA);
    expect(access.ok).toBe(false);
    if (access.ok) return;
    expect(access.reason).toBe("not_enrolled");
    expect(await usersNamed(VIEWER.login)).toBe(0);
  });

  it("with the check on, still stops a non-member first, invite or not", async () => {
    const { token } = await invite();
    const access = await resolveAccess(VIEWER, false, { orgRequired: true, inviteToken: token });
    expect(access.ok).toBe(false);
    if (access.ok) return;
    expect(access.reason).toBe("not_a_member");
    const { rows } = await db().query<{ used_at: Date | null }>("select used_at from invite");
    expect(rows[0]!.used_at).toBeNull();
  });

  it("with the check on, lets an organisation member enrol through an invite", async () => {
    const { token } = await invite();
    expect((await resolveAccess(VIEWER, true, { orgRequired: true, inviteToken: token })).ok)
      .toBe(true);
  });

  it("is on unless the environment turns it off, and asks GitHub for less when it is off", () => {
    expect(orgCheckRequired({})).toBe(true);
    expect(orgCheckRequired({ GITHUB_ORG_CHECK: "on" })).toBe(true);
    expect(orgCheckRequired({ GITHUB_ORG_CHECK: "off" })).toBe(false);
    expect(oauthScope({})).toBe("read:user read:org");
    expect(oauthScope({ GITHUB_ORG_CHECK: "off" })).toBe("read:user");
  });

  it("refuses a setting it does not recognise rather than guessing", () => {
    expect(() => orgCheckRequired({ GITHUB_ORG_CHECK: "no" })).toThrow(/GITHUB_ORG_CHECK/);
  });
});

describe("what the database holds", () => {
  it("keeps only a hash of the token", async () => {
    const { token } = await invite();
    const { rows } = await db().query<Record<string, unknown>>("select * from invite");
    const stored = JSON.stringify(rows[0]);
    expect(stored).not.toContain(token);
    expect(rows[0]!["token_sha256"]).toBe(createHash("sha256").update(token).digest("hex"));
  });

  it("issues tokens nobody can guess from the last one", async () => {
    const a = (await invite()).token;
    const b = (await invite()).token;
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("audits creating and withdrawing an invite, with who did it", async () => {
    const { id } = await invite({ note: "Priya from the pilot group" });
    await revokeInvite(id, admin.userId);
    const { rows } = await db().query<{ action: string; actor_id: string }>(
      "select action, actor_id from audit_log order by id");
    expect(rows.map((r) => r.action)).toEqual(["invite_created", "invite_revoked"]);
    expect(rows.every((r) => Number(r.actor_id) === admin.userId)).toBe(true);
  });

  it("lists every invite with the state an admin needs to act on", async () => {
    const used = await invite();
    await resolveAccess(VIEWER, false, { ...BETA, inviteToken: used.token });
    const expired = await invite();
    await db().query("update invite set expires_at = now() - interval '1 minute' where id = $1",
      [expired.id]);
    const withdrawn = await invite();
    await revokeInvite(withdrawn.id, admin.userId);
    const pending = await invite({ githubLogin: "priya-k" });

    const rows = await listInvites(admin.cohortId);
    const state = Object.fromEntries(rows.map((r) => [r.id, r.state]));
    expect(state[used.id]).toBe("used");
    expect(state[expired.id]).toBe("expired");
    expect(state[withdrawn.id]).toBe("withdrawn");
    expect(state[pending.id]).toBe("pending");
    expect(rows.find((r) => r.id === used.id)!.usedByLogin).toBe(VIEWER.login);
    expect(rows.find((r) => r.id === pending.id)!.githubLogin).toBe("priya-k");
  });
});

describe("the first admin, before anyone can sign in", () => {
  it("gets in through an invite minted on the host, into a cohort it makes", async () => {
    const minted = await mintInviteOnHost({ cohortSlug: "pilot-1", githubLogin: VIEWER.login });
    const { rows: cohorts } = await db().query<{ id: string; slug: string }>(
      "select id, slug from cohort where slug = 'pilot-1'");
    expect(Number(cohorts[0]!.id)).toBe(minted.cohortId);

    const access = await resolveAccess(VIEWER, false, { ...BETA, inviteToken: minted.token });
    expect(access.ok).toBe(true);
    if (!access.ok) return;
    expect(access.role).toBe("admin");
    expect(access.cohortId).toBe(minted.cohortId);

    const { rows } = await db().query<{ action: string; actor_id: string | null }>(
      "select action, actor_id from audit_log where action = 'invite_created'");
    expect(rows[0]!.actor_id).toBeNull();
  });

  it("reuses a cohort that already has the slug rather than making a second", async () => {
    const first = await mintInviteOnHost({ cohortSlug: "pilot-1", githubLogin: "one" });
    const second = await mintInviteOnHost({ cohortSlug: "pilot-1", githubLogin: "two" });
    expect(second.cohortId).toBe(first.cohortId);
  });

  it("refuses a slug that would not survive a URL", async () => {
    await expect(mintInviteOnHost({ cohortSlug: "Pilot One!", githubLogin: "one" }))
      .rejects.toThrow(/cohort slug/);
  });
});
