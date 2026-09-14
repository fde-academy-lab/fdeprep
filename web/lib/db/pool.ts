import { Pool, type PoolClient } from "pg";

/**
 * One pool per process. DATABASE_URL carries no credentials in development,
 * where Postgres trusts the local socket.
 */
let pool: Pool | undefined;

export function db(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString:
        process.env.DATABASE_URL ?? "postgresql://localhost:5432/fdeprep",
      max: Number(process.env.PGPOOL_MAX ?? 10),
    });
  }
  return pool;
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
}

/**
 * Run `work` inside one transaction. The outbox in docs/03 section 9.2 depends
 * on the submission row, the cap decrement and the message being one unit, so
 * every write path that touches those three goes through here.
 */
export async function inTransaction<T>(
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await db().connect();
  try {
    await client.query("begin");
    const value = await work(client);
    await client.query("commit");
    return value;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
