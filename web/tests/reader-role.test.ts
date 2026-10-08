/**
 * The reader role. docs/11 acceptance 4 and docs/12 acceptance 8, as amended
 * 8 October 2026 for story S15.7.
 *
 * Migration 026 creates fdeprep_reader, with SELECT on every table and no
 * write grant, when the user running the migrations may create roles, and
 * otherwise skips with a notice. tests/writer-boundary.test.ts is the
 * enforced boundary; this role is the second line behind it, and the
 * application does not run under it in this release.
 */
import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "../lib/db/pool.ts";
import { resetDatabase } from "./helpers.ts";

const ROLE = "fdeprep_reader";
const GRADE_TABLES = ["evaluation", "evaluation_review", "competency_score"];
const WRITES = ["insert", "update", "delete", "truncate"];

beforeAll(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closeDb();
});

/** Whether this database user could have created the role, as the migration asks. */
async function mayCreateRoles(): Promise<boolean> {
  const { rows } = await db().query<{ may: boolean }>(
    `select rolcreaterole or rolsuper as may from pg_roles where rolname = current_user`);
  return rows[0]?.may === true;
}

async function roleExists(): Promise<boolean> {
  const { rows } = await db().query("select 1 from pg_roles where rolname = $1", [ROLE]);
  return rows.length > 0;
}

/** Run `work` as the reader inside a transaction that is always rolled back. */
async function asReader<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db().connect();
  try {
    await client.query("begin");
    await client.query(`set local role ${ROLE}`);
    return await work(client);
  } finally {
    await client.query("rollback");
    client.release();
  }
}

/** The SQLSTATE a statement failed with, or null when it ran. */
async function refusal(sql: string): Promise<string | null> {
  try {
    await asReader((client) => client.query(sql));
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? "no code";
  }
}

describe("the reader role", () => {
  it("exists wherever the migrating user may create roles", async (context) => {
    if (!(await mayCreateRoles())) context.skip();
    expect(await roleExists()).toBe(true);
  });

  it("holds SELECT on every table and no write on a grade table or on submission", async (context) => {
    if (!(await roleExists())) context.skip();
    for (const table of [...GRADE_TABLES, "submission"]) {
      for (const privilege of WRITES) {
        const { rows } = await db().query<{ granted: boolean }>(
          "select has_table_privilege($1, $2, $3) as granted", [ROLE, table, privilege]);
        expect(rows[0]!.granted, `${privilege} on ${table}`).toBe(false);
      }
    }
    // By oid, so no table name is resolved against a schema it is not in.
    const { rows: unreadable } = await db().query<{ name: string }>(
      `select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
          and not has_table_privilege($1, c.oid, 'select')`, [ROLE]);
    expect(unreadable.map((row) => row.name)).toEqual([]);
  });

  it("is refused a write to competency_score, evaluation and submission", async (context) => {
    if (!(await roleExists())) context.skip();
    const insufficientPrivilege = "42501";
    expect(await refusal(
      `insert into competency_score (enrolment_id, competency_id, difficulty, state)
       values (1, 1, 'easy', 'clean')`)).toBe(insufficientPrivilege);
    expect(await refusal("update competency_score set state = 'clean'")).toBe(insufficientPrivilege);
    expect(await refusal("update evaluation set score = 100")).toBe(insufficientPrivilege);
    expect(await refusal("delete from evaluation_review")).toBe(insufficientPrivilege);
    expect(await refusal("update submission set verdict = 'pass', score = 100"))
      .toBe(insufficientPrivilege);
  });

  it("reads what progress/ and analytics/ read", async (context) => {
    if (!(await roleExists())) context.skip();
    const counted = await asReader(async (client) => (await client.query<{ n: number }>(
      `select (select count(*) from competency_score)::int
            + (select count(*) from evaluation)::int as n`)).rows[0]!.n);
    expect(counted).toBe(0);
  });
});
