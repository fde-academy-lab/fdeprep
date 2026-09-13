/**
 * Who is asking.
 *
 * GitHub sign-in is Phase 5. Until then a development learner is resolved (and
 * created on first use) so the workspace has an enrolment to write attempts
 * against. Nothing here trusts a client-supplied identity, which is the rule
 * that matters: the browser never supplies an enrolment id.
 */
import { db } from "../db/pool.ts";

export interface Learner {
  enrolmentId: number;
  cohortId: number;
  userId: number;
  displayName: string;
  role: "learner" | "faculty" | "admin";
}

export async function currentLearner(): Promise<Learner> {
  const pool = db();
  const existing = await pool.query<{
    enrolment_id: string; cohort_id: string; user_id: string;
    display_name: string; role: Learner["role"];
  }>(
    `select e.id as enrolment_id, e.cohort_id, u.id as user_id, u.display_name,
            e.role::text as role
       from enrolment e join app_user u on u.id = e.user_id
      order by e.id limit 1`);

  const row = existing.rows[0];
  if (row) {
    return {
      enrolmentId: Number(row.enrolment_id), cohortId: Number(row.cohort_id),
      userId: Number(row.user_id), displayName: row.display_name, role: row.role,
    };
  }

  const user = await pool.query<{ id: string }>(
    `insert into app_user (github_id, github_login, display_name)
     values (0, 'dev', 'Development learner')
     on conflict (github_id) do update set github_login = excluded.github_login
     returning id`);
  const cohort = await pool.query<{ id: string }>(
    `insert into cohort (slug, name, starts_on) values ('dev', 'Development', current_date)
     on conflict (slug) do update set name = excluded.name returning id`);
  const enrolment = await pool.query<{ id: string }>(
    `insert into enrolment (user_id, cohort_id, role) values ($1, $2, 'admin')
     on conflict (user_id, cohort_id) do update set role = excluded.role returning id`,
    [user.rows[0]!.id, cohort.rows[0]!.id]);

  return {
    enrolmentId: Number(enrolment.rows[0]!.id), cohortId: Number(cohort.rows[0]!.id),
    userId: Number(user.rows[0]!.id), displayName: "Development learner", role: "admin",
  };
}
