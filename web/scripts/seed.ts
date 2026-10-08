/**
 * A database full of believable activity, for building and reviewing screens.
 *
 *   npm run db:seed                 seed, refusing if a seed is already there
 *   npm run db:seed -- --replace    remove the previous seed, then seed again
 *   npm run db:seed -- --yes        required when NODE_ENV is production
 *
 * Needs DATABASE_URL and a published catalogue, so run npm run migrate and
 * npm run import:content first. Forty people in two cohorts, ninety days of
 * practice, every grade written by eval/ through the record path a learner's
 * own work takes. lib/seed/run.ts says how; lib/seed/plan.ts says what.
 *
 * There is no db:reset here, although docs/06 Phase 0 names one: the test
 * helper that empties a database refuses any database whose name does not end
 * in _test, on purpose, and a reset for development deserves its own story.
 */
import { closeDb, db } from "../lib/db/pool.ts";
import { seedTracks } from "../lib/policy/roadmap.ts";
import { loadCatalogue } from "../lib/seed/catalogue.ts";
import { COHORTS } from "../lib/seed/names.ts";
import { plan } from "../lib/seed/plan.ts";
import { removeSeed } from "../lib/seed/replace.ts";
import { runSeed, SeedRefused } from "../lib/seed/run.ts";

/** Returns the exit code. Every refusal says what to run next. */
export async function seedCommand(
  argv: readonly string[], say: (line: string) => void = console.log,
): Promise<number> {
  const replace = argv.includes("--replace");
  const yes = argv.includes("--yes");

  const { rows: published } = await db().query<{ n: number }>(
    "select count(*)::int as n from problem where is_published");
  if (published[0]!.n === 0) {
    say("No problems are published. Run npm run import:content first, then npm run db:seed.");
    return 1;
  }
  if (process.env.NODE_ENV === "production" && !yes) {
    say("NODE_ENV is production. This would write forty seeded learners, about 1,100 " +
        "submissions and 160 voice answers into this database. Add --yes to do it anyway.");
    return 1;
  }

  const { rows: existing } = await db().query(
    "select 1 from cohort where slug = $1", [COHORTS[0]!.slug]);
  if (existing.length && !replace) {
    say(`This database already holds the seed (cohort ${COHORTS[0]!.slug}). Run npm run ` +
        "db:seed -- --replace to remove it and seed again.");
    return 1;
  }
  if (existing.length) {
    await removeSeed();
    say("Removed the previous seed.");
  }

  await seedTracks();
  const seeded = plan({ today: new Date().toISOString().slice(0, 10),
                        catalogue: await loadCatalogue() });
  say(`Seeding ${seeded.people.length} people over 90 days: ${seeded.expected.submissions} ` +
      `submissions and ${seeded.expected.voiceSessions} voice answers. About two minutes.`);

  let report;
  try {
    report = await runSeed(seeded, { log: say });
  } catch (error) {
    if (error instanceof SeedRefused) {
      say(error.message);
      return 1;
    }
    throw error;
  }

  say("\nSeeded rows per table, the rows --replace removes");
  for (const { table, rows } of report.counts) say(`  ${table.padEnd(26)} ${rows}`);
  say("\nReadiness of the three named learners");
  for (const { login, displayName, readiness: r } of report.named) {
    say(`  ${displayName} (${login}): ${r.percent}% ${r.band}, clean ${r.clean}, passed ` +
        `${r.passed}, attempted ${r.attempted}, untouched ${r.untouched} of ${r.required}`);
  }
  say("\nOne learner per archetype, to open");
  for (const { archetype, login } of report.archetypes) say(`  ${archetype.padEnd(9)} ${login}`);
  say("\nSign in as the development admin with AUTH_DEV_LEARNER=1 and open the roster.");
  return 0;
}

if (import.meta.filename === process.argv[1]) {
  try {
    process.exitCode = await seedCommand(process.argv.slice(2));
  } finally {
    await closeDb();
  }
}
