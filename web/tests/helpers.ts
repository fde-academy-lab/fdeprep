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
             problem, rate_limit_counter, enrolment, cohort, app_user, audit_log,
             voice_nudge, voice_beat_result, voice_session, voice_consent,
             voice_beat, voice_question
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

export interface SeedLearnerOptions {
  persona?: "builder" | "navigator" | "accelerator";
  /** Distinct per learner, since app_user.github_id is unique. */
  githubId?: number;
  login?: string;
  /** Reuse an existing cohort rather than making another one. */
  cohortId?: number;
}

export async function seedLearner(
  options: SeedLearnerOptions = {},
): Promise<{ enrolmentId: number; cohortId: number; userId: number }> {
  const pool = db();
  const githubId = options.githubId ?? 1;
  const login = options.login ?? `learner${githubId}`;
  const user = await pool.query<{ id: string }>(
    `insert into app_user (github_id, github_login, display_name)
     values ($1, $2, $3) returning id`,
    [githubId, login, "A Learner"]);
  const cohortId = options.cohortId ?? Number((await pool.query<{ id: string }>(
    `insert into cohort (slug, name, starts_on) values ('c3', 'Cohort 3', current_date)
     on conflict (slug) do update set name = excluded.name
     returning id`)).rows[0]!.id);
  const enrolment = await pool.query<{ id: string }>(
    `insert into enrolment (user_id, cohort_id, persona)
     values ($1, $2, $3::persona) returning id`,
    [user.rows[0]!.id, cohortId, options.persona ?? "navigator"]);
  return {
    userId: Number(user.rows[0]!.id),
    cohortId,
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
