/**
 * Mint an invite on the host, for the first admin.
 *
 * With GITHUB_ORG_CHECK=off nobody gets in without an invite, and invites are
 * made on the Roster screen, which only an admin can open. This is the way in
 * that does not start from a browser. It needs only DATABASE_URL, and APP_URL
 * to print a whole link.
 *
 *   npm run invite -- --login your-github-login
 *   npm run invite -- --login someone --role learner --cohort pilot-1 --days 7
 *
 * The cohort is made if its slug is new. The role defaults to admin, because
 * this is for the person who will invite everyone else from the screen.
 */
import { closeDb } from "../lib/db/pool.ts";
import { mintInviteOnHost, type InvitePersona, type InviteRole } from "../lib/auth/invite.ts";

function option(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at > -1 ? process.argv[at + 1] : undefined;
}

async function main(): Promise<void> {
  const login = option("login");
  if (!login) {
    console.error("Name the GitHub login this invite is for: npm run invite -- --login your-login");
    process.exitCode = 1;
    return;
  }
  const days = option("days");
  const invite = await mintInviteOnHost({
    githubLogin: login,
    role: (option("role") ?? "admin") as InviteRole,
    persona: option("persona") as InvitePersona | undefined,
    cohortSlug: option("cohort") ?? "pilot-1",
    cohortName: option("cohort-name"),
    expiresInDays: days ? Number(days) : undefined,
  });
  const path = `/invite/${invite.token}`;
  const origin = process.env.APP_URL?.replace(/\/+$/, "");
  console.log(origin
    ? `${origin}${path}`
    : `${path}\n(APP_URL is not set, so put your site's address in front of that path.)`);
  console.log(`Works once, for GitHub login ${login}, until ${invite.expiresAt.slice(0, 10)}.`);
}

if (import.meta.filename === process.argv[1]) {
  try {
    await main();
  } finally {
    await closeDb();
  }
}
