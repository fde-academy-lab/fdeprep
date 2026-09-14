import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { db } from "../lib/db/pool.ts";
import { migrate } from "../scripts/migrate.ts";
import { seedRateLimitPolicies } from "../lib/db/seed.ts";
import { publishImport } from "../lib/problems/import.ts";
import { validateProblemYaml } from "../lib/problems/validate.ts";

export const FIXTURES = path.join(import.meta.dirname, "..", "..", "problems", "_fixtures");

let migrated = false;

export async function resetDatabase(): Promise<void> {
  if (!migrated) {
    await migrate(() => {});
    migrated = true;
  }
  await db().query(`
    truncate outbox, queue_message, runner_event, hint_reveal, submission, attempt,
             step_check, problem_test, hint, problem_competency, problem_version,
             problem, rate_limit_counter, enrolment, cohort, app_user, audit_log
    restart identity cascade`);

  // truncate cohort cascade takes rate_limit_policy with it, so put the seed
  // back. Without this every cap silently passes and the cap tests prove
  // nothing.
  await seedRateLimitPolicies(db());
  const { rows } = await db().query<{ count: string }>(
    "select count(*) from rate_limit_policy");
  if (Number(rows[0]!.count) === 0) {
    throw new Error("rate_limit_policy is empty after reset, so no cap would bind");
  }
}

export async function seedLearner(): Promise<{ enrolmentId: number; cohortId: number; userId: number }> {
  const pool = db();
  const user = await pool.query<{ id: string }>(
    `insert into app_user (github_id, github_login, display_name)
     values (1, 'learner', 'A Learner') returning id`);
  const cohort = await pool.query<{ id: string }>(
    `insert into cohort (slug, name, starts_on) values ('c3', 'Cohort 3', current_date)
     returning id`);
  const enrolment = await pool.query<{ id: string }>(
    `insert into enrolment (user_id, cohort_id) values ($1, $2) returning id`,
    [user.rows[0]!.id, cohort.rows[0]!.id]);
  return {
    userId: Number(user.rows[0]!.id),
    cohortId: Number(cohort.rows[0]!.id),
    enrolmentId: Number(enrolment.rows[0]!.id),
  };
}

/** Import every fixture problem, the way the admin screen would. */
export async function importFixtures(): Promise<number> {
  const files = (await readdir(FIXTURES)).filter((f) => f.endsWith(".yaml")).sort();
  for (const file of files) {
    const source = await readFile(path.join(FIXTURES, file), "utf8");
    const report = validateProblemYaml(source, file);
    if (!report.problem) throw new Error(`${file} does not validate: ${JSON.stringify(report.errors)}`);
    await publishImport(report.problem, source, { publish: true });
  }
  return files.length;
}
