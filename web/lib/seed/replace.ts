/**
 * Removing a previous seed, for `npm run db:seed -- --replace`.
 *
 * Deletes the seeded cohorts and every row that hangs off them, children
 * first, in one transaction, and the audit rows the seeded people's actions
 * wrote. Nothing else: the seeded GitHub accounts stay and are reused on the
 * next run, the development account stays, and no table is truncated.
 *
 * The rows are found by following the foreign keys the schema declares, not
 * from a list of tables kept here. A table added later is cleared without
 * anyone remembering to add it, and the seed never names a table that holds a
 * grade, which eval/ alone writes. The seed's closing report counts the same
 * rows the same way.
 */
import type { Pool, PoolClient } from "pg";
import { db, inTransaction } from "../db/pool.ts";
import { COHORTS, FIRST_GITHUB_ID, PEOPLE } from "./names.ts";

interface Reference { child: string; columns: string[]; parentColumns: string[] }

/** The seeded cohorts, with their ids as $1. */
const SEEDED_COHORTS = "id = any($1::bigint[])";

/** Returns how many seeded cohorts were removed: 0 when there was no seed. */
export async function removeSeed(): Promise<number> {
  return inTransaction(async (client) => {
    const cohorts = await seededCohorts(client);
    if (!cohorts.length) return 0;

    const [audit, params] = seededAudit(cohorts);
    await client.query(`delete from audit_log where ${audit}`, params);
    for (const { table, where } of below(await references(client), "cohort", SEEDED_COHORTS)) {
      await client.query(`delete from ${ident(table)} where ${where}`, [cohorts]);
    }
    return cohorts.length;
  });
}

/**
 * How many rows removeSeed would delete from each table, found the same way,
 * so the closing report counts the seed and nothing that was already in the
 * database: not the catalogue, not a global cap policy, not a developer's own
 * answers.
 */
export async function seedRowCounts(): Promise<Array<{ table: string; rows: number }>> {
  const pool = db();
  const cohorts = await seededCohorts(pool);
  const count = async (table: string, where: string, params: unknown[]) =>
    (await pool.query<{ n: number }>(
      `select count(*)::int as n from ${ident(table)} where ${where}`, params)).rows[0]!.n;

  // A table reached by several foreign-key paths owns the rows any of them finds.
  const paths = new Map<string, string[]>();
  for (const { table, where } of below(await references(pool), "cohort", SEEDED_COHORTS)) {
    paths.set(table, [...(paths.get(table) ?? []), `(${where})`]);
  }
  const counts = [{ table: "audit_log", rows: await count("audit_log", ...seededAudit(cohorts)) }];
  for (const [table, wheres] of paths) {
    counts.push({ table, rows: await count(table, wheres.join(" or "), [cohorts]) });
  }
  return counts.filter((c) => c.rows > 0).sort((a, b) => a.table.localeCompare(b.table));
}

async function seededCohorts(client: Pool | PoolClient): Promise<number[]> {
  const { rows } = await client.query<{ id: string }>(
    "select id from cohort where slug = any($1::text[])", [COHORTS.map((c) => c.slug)]);
  return rows.map((row) => Number(row.id));
}

/**
 * Audit rows carry no foreign key to what they describe, so they are found by
 * who wrote them: a seeded person, or nobody, about a seeded enrolment (a hint
 * revealed writes no actor).
 */
function seededAudit(cohorts: number[]): [string, unknown[]] {
  return [
    `actor_id in (select id from app_user where github_id between $1 and $2)
       or (actor_id is null and detail ? 'enrolment_id'
           and (detail ->> 'enrolment_id')::bigint in
               (select id from enrolment where cohort_id = any($3::bigint[])))`,
    [FIRST_GITHUB_ID, FIRST_GITHUB_ID + PEOPLE.length - 1, cohorts],
  ];
}

/** Every foreign key in the schema, grouped by the table it points at. */
async function references(client: Pool | PoolClient): Promise<Map<string, Reference[]>> {
  const { rows } = await client.query<{
    parent: string; child: string; columns: string[]; parent_columns: string[];
  }>(
    `select parent.relname as parent, child.relname as child,
            array(select a.attname::text
                    from unnest(c.conkey) with ordinality k(attnum, i)
                    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
                   order by k.i) as columns,
            array(select a.attname::text
                    from unnest(c.confkey) with ordinality k(attnum, i)
                    join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum
                   order by k.i) as parent_columns
       from pg_constraint c
       join pg_class child on child.oid = c.conrelid
       join pg_class parent on parent.oid = c.confrelid
       join pg_namespace n on n.oid = child.relnamespace
      where c.contype = 'f' and n.nspname = 'public'`);
  const byParent = new Map<string, Reference[]>();
  for (const row of rows) {
    const list = byParent.get(row.parent) ?? [];
    list.push({ child: row.child, columns: row.columns, parentColumns: row.parent_columns });
    byParent.set(row.parent, list);
  }
  return byParent;
}

/**
 * The rows of `table` matching `where`, after every row that points at them:
 * one (table, where) per foreign-key path, children first, which is the order
 * a delete has to run in.
 */
function* below(
  references: Map<string, Reference[]>, table: string, where: string, depth = 0,
): Generator<{ table: string; where: string }> {
  if (depth > 10) throw new Error(`foreign keys nest deeper than expected below ${table}`);
  for (const ref of references.get(table) ?? []) {
    if (ref.child === table) continue;
    yield* below(references, ref.child,
      `(${ref.columns.map(ident).join(", ")}) in ` +
      `(select ${ref.parentColumns.map(ident).join(", ")} from ${ident(table)} where ${where})`,
      depth + 1);
  }
  yield { table, where };
}

function ident(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`unexpected identifier ${name}`);
  return name;
}
