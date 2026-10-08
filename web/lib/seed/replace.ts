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
 * grade, which eval/ alone writes.
 */
import type { PoolClient } from "pg";
import { inTransaction } from "../db/pool.ts";
import { COHORTS, FIRST_GITHUB_ID, PEOPLE } from "./names.ts";

interface Reference { child: string; columns: string[]; parentColumns: string[] }

/** Returns how many seeded cohorts were removed: 0 when there was no seed. */
export async function removeSeed(): Promise<number> {
  return inTransaction(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      "select id from cohort where slug = any($1::text[])", [COHORTS.map((c) => c.slug)]);
    if (!rows.length) return 0;
    const cohorts = rows.map((row) => Number(row.id));

    // Audit rows carry no foreign key to what they describe, so they are
    // found by who wrote them: a seeded person, or nobody, about a seeded
    // enrolment (a hint revealed writes no actor).
    await client.query(
      `delete from audit_log
        where actor_id in (select id from app_user where github_id between $1 and $2)
           or (actor_id is null and detail ? 'enrolment_id'
               and (detail ->> 'enrolment_id')::bigint in
                   (select id from enrolment where cohort_id = any($3::bigint[])))`,
      [FIRST_GITHUB_ID, FIRST_GITHUB_ID + PEOPLE.length - 1, cohorts]);

    await deleteDown(client, await references(client), "cohort",
                     "id = any($1::bigint[])", [cohorts], 0);
    return cohorts.length;
  });
}

/** Every foreign key in the schema, grouped by the table it points at. */
async function references(client: PoolClient): Promise<Map<string, Reference[]>> {
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

/** Delete the rows of `table` matching `where`, after every row that points at them. */
async function deleteDown(
  client: PoolClient, references: Map<string, Reference[]>, table: string,
  where: string, params: unknown[], depth: number,
): Promise<void> {
  if (depth > 10) throw new Error(`foreign keys nest deeper than expected below ${table}`);
  for (const ref of references.get(table) ?? []) {
    if (ref.child === table) continue;
    await deleteDown(client, references, ref.child,
      `(${ref.columns.map(ident).join(", ")}) in ` +
      `(select ${ref.parentColumns.map(ident).join(", ")} from ${ident(table)} where ${where})`,
      params, depth + 1);
  }
  await client.query(`delete from ${ident(table)} where ${where}`, params);
}

function ident(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`unexpected identifier ${name}`);
  return name;
}
