/**
 * The submissions browser, S10's third screen.
 *
 * "Filterable by learner, problem, verdict and date, with a link to every
 * trace." Faculty see this in full, which is why it carries no learner code:
 * the browser is for finding a submission, and the workspace is for reading it.
 */
import type { Pool, PoolClient } from "pg";
import { db } from "../db/pool.ts";

export interface SubmissionFilters {
  login?: string;
  slug?: string;
  verdict?: string;
  since?: string;
  page?: number;
  perPage?: number;
}

export interface BrowserRow {
  id: number;
  login: string;
  slug: string;
  title: string;
  kind: string;
  verdict: string | null;
  status: string;
  score: number | null;
  queuedAt: string;
  finishedAt: string | null;
  hasTrace: boolean;
}

export interface BrowserPage {
  rows: BrowserRow[];
  total: number;
  page: number;
  perPage: number;
}

export async function browseSubmissions(
  filters: SubmissionFilters, client: Pool | PoolClient = db(),
): Promise<BrowserPage> {
  const page = Math.max(1, filters.page ?? 1);
  const perPage = Math.min(200, Math.max(1, filters.perPage ?? 50));

  const where: string[] = [];
  const params: unknown[] = [];
  const add = (clause: string, value: unknown) => {
    params.push(value);
    where.push(clause.replace("$?", `$${params.length}`));
  };

  if (filters.login) add("lower(u.github_login) = lower($?)", filters.login);
  if (filters.slug) add("p.slug = $?", filters.slug);
  if (filters.verdict && filters.verdict !== "all") {
    if (filters.verdict === "open") where.push("s.verdict is null");
    else add("s.verdict = $?::verdict", filters.verdict);
  }
  if (filters.since) add("s.queued_at >= $?::timestamptz", filters.since);

  const clause = where.length ? `where ${where.join(" and ")}` : "";

  const { rows: counted } = await client.query<{ count: string }>(
    `select count(*) from submission s
       join attempt a on a.id = s.attempt_id
       join enrolment e on e.id = a.enrolment_id
       join app_user u on u.id = e.user_id
       join problem_version v on v.id = s.problem_version_id
       join problem p on p.id = v.problem_id
     ${clause}`, params);

  const { rows } = await client.query<{
    id: string; login: string; slug: string; title: string; kind: string;
    verdict: string | null; status: string; score: string | null;
    queued_at: Date; finished_at: Date | null; has_trace: boolean;
  }>(
    `select s.id, u.github_login as login, p.slug, p.title, s.kind::text as kind,
            s.verdict::text as verdict, s.status::text as status, s.score,
            s.queued_at, s.finished_at,
            exists (select 1 from trace t where t.submission_id = s.id) as has_trace
       from submission s
       join attempt a on a.id = s.attempt_id
       join enrolment e on e.id = a.enrolment_id
       join app_user u on u.id = e.user_id
       join problem_version v on v.id = s.problem_version_id
       join problem p on p.id = v.problem_id
     ${clause}
      order by s.queued_at desc, s.id desc
      limit ${perPage} offset ${(page - 1) * perPage}`, params);

  return {
    rows: rows.map((row) => ({
      id: Number(row.id),
      login: row.login,
      slug: row.slug,
      title: row.title,
      kind: row.kind,
      verdict: row.verdict,
      status: row.status,
      score: row.score === null ? null : Number(row.score),
      queuedAt: row.queued_at.toISOString(),
      finishedAt: row.finished_at ? row.finished_at.toISOString() : null,
      hasTrace: row.has_trace,
    })),
    total: Number(counted[0]!.count),
    page,
    perPage,
  };
}
