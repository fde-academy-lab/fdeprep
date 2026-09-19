/**
 * Who is asking.
 *
 * The signed cookie carries one claim, the app_user id. Everything the rest of
 * the application acts on, the enrolment, the cohort, the role and the
 * persona, is read here from the database on every request. A forged cookie
 * has nothing useful to forge and a stale one resolves to whatever the roster
 * says now, which is what makes removing somebody from a cohort take effect
 * without hunting down their session.
 *
 * .claude/rules/01: the browser may not supply an enrolment id, an execution
 * role, a difficulty or a cap allowance. It supplies a signature over a user
 * id, and that is all.
 *
 * proxy.ts turns away a request with no cookie before it reaches a page, so
 * the redirect below is for the rarer cases: a cookie that expired between the
 * proxy and here, or one somebody edited.
 */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "../db/pool.ts";
import { SESSION_COOKIE, SessionRejected, readSession } from "../auth/session.ts";
import { authSecret, devLearnerEnabled } from "../auth/config.ts";

export interface Learner {
  enrolmentId: number;
  cohortId: number;
  userId: number;
  displayName: string;
  role: "learner" | "faculty" | "admin";
  persona: "builder" | "navigator" | "accelerator";
}

interface Row {
  enrolment_id: string;
  cohort_id: string;
  user_id: string;
  display_name: string;
  role: Learner["role"];
  persona: Learner["persona"];
}

const SELECT = `
  select e.id as enrolment_id, e.cohort_id, u.id as user_id, u.display_name,
         e.role::text as role, e.persona::text as persona
    from enrolment e join app_user u on u.id = e.user_id
   where e.state = 'active'`;

function toLearner(row: Row): Learner {
  return {
    enrolmentId: Number(row.enrolment_id),
    cohortId: Number(row.cohort_id),
    userId: Number(row.user_id),
    displayName: row.display_name,
    role: row.role,
    persona: row.persona,
  };
}

/** The signed-in learner, or a redirect to sign in. */
export async function currentLearner(): Promise<Learner> {
  const learner = await learnerOrNull();
  if (!learner) redirect("/signin");
  return learner;
}

/**
 * The signed-in learner, or null.
 *
 * Route handlers use this when they would rather answer 401 than redirect a
 * fetch into an HTML page the caller cannot parse.
 */
export async function learnerOrNull(): Promise<Learner | null> {
  const cookie = await sessionCookie();

  if (!cookie) return devLearnerEnabled() ? await developmentLearner() : null;

  let uid: number;
  try {
    uid = readSession(cookie, authSecret()).uid;
  } catch (error) {
    if (error instanceof SessionRejected) return null;
    throw error;
  }

  const { rows } = await db().query<Row>(`${SELECT} and u.id = $1 order by e.id desc limit 1`,
    [uid]);
  const row = rows[0];
  return row ? toLearner(row) : null;
}

/**
 * The cookie, or undefined when there is no request to read one from.
 *
 * `cookies()` throws outside a request scope, which is where a test calling a
 * route handler directly lives. No request means no cookie, and the caller
 * treats that as nobody being signed in, so the failure is closed: a page
 * redirects and a route handler refuses. The only path that opens from here is
 * the development learner, and that is off unless somebody set it.
 */
async function sessionCookie(): Promise<string | undefined> {
  try {
    return (await cookies()).get(SESSION_COOKIE)?.value;
  } catch {
    return undefined;
  }
}

/**
 * The local escape hatch, off unless AUTH_DEV_LEARNER=1.
 *
 * Running the platform on a laptop means running it without a GitHub OAuth
 * application, and the alternative to this is that nobody can open any screen.
 * It is refused whenever GITHUB_CLIENT_ID is set, so an environment configured
 * for real sign-in cannot also have a back door, and lib/auth/config.ts
 * refuses it outright in production.
 */
async function developmentLearner(): Promise<Learner> {
  const pool = db();
  const { rows } = await pool.query<Row>(`${SELECT} order by e.id limit 1`);
  if (rows[0]) return toLearner(rows[0]);

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
    enrolmentId: Number(enrolment.rows[0]!.id),
    cohortId: Number(cohort.rows[0]!.id),
    userId: Number(user.rows[0]!.id),
    displayName: "Development learner",
    role: "admin",
    persona: "navigator",
  };
}
