/** Apply every migration that has not run yet, in filename order. */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { closeDb, db } from "../lib/db/pool.ts";

const DIR = path.join(import.meta.dirname, "..", "migrations");

export async function migrate(log: (line: string) => void = console.log) {
  const pool = db();
  await pool.query(`
    create table if not exists schema_migration (
      name text primary key,
      applied_at timestamptz not null default now()
    )`);

  const applied = new Set(
    (await pool.query<{ name: string }>("select name from schema_migration")).rows.map(
      (row) => row.name,
    ),
  );

  const files = (await readdir(DIR)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(DIR, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into schema_migration (name) values ($1)", [file]);
      await client.query("commit");
      log(`applied ${file}`);
    } catch (error) {
      await client.query("rollback");
      throw new Error(`${file} failed: ${(error as Error).message}`);
    } finally {
      client.release();
    }
  }
}

if (import.meta.filename === process.argv[1]) {
  await migrate();
  await closeDb();
}
