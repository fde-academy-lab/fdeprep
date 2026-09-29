/**
 * The web tests truncate every table in the database they run against.
 *
 * Until this guard, that database was whatever DATABASE_URL named. The README's
 * own setup steps point it at `fdeprep`, and pool.ts falls back to `fdeprep`
 * when nothing is set, so `npm test` on a developer's machine wiped the
 * catalogue, the users and every graded submission. Every cloud session lost
 * its development database the same way, because its environment sets
 * TEST_DATABASE_URL for exactly this purpose and nothing read it.
 */
import type { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { closeDb, db } from "../lib/db/pool.ts";
import { assertTestDatabase, resetDatabase } from "./helpers.ts";

afterAll(async () => {
  await closeDb();
});

describe("which databases the suite may reset", () => {
  it("accepts a database named for tests", () => {
    expect(() => assertTestDatabase("fdeprep_test")).not.toThrow();
    expect(() => assertTestDatabase("scratch_test")).not.toThrow();
  });

  it("refuses the development database and names that only resemble a test one", () => {
    for (const name of ["fdeprep", "postgres", "fdeprep_testing", "test", "fdeprep-test"]) {
      expect(() => assertTestDatabase(name)).toThrow(/ends in _test/);
    }
  });

  it("says how to get a test database, not only that it refused", () => {
    // .claude/rules/02-writing.md: a message names the next action.
    expect(() => assertTestDatabase("fdeprep")).toThrow(/createdb fdeprep_test/);
    expect(() => assertTestDatabase("fdeprep")).toThrow(/TEST_DATABASE_URL/);
  });
});

describe("the reset itself", () => {
  it("asks the connection it is about to truncate, and truncates nothing when refused", async () => {
    // A connection that reports a development database and records everything
    // asked of it. If the guard stops running, or asks some other connection,
    // the reset goes on to truncate through this one and never refuses.
    //
    // A real throwaway database was the first version of this test, and it
    // timed out one run in four: CREATE and DROP DATABASE may wait up to five
    // seconds for other sessions to leave, which is vitest's whole budget.
    const asked: string[] = [];
    const development = {
      async query(sql: string) {
        asked.push(sql);
        return { rows: [{ name: "fdeprep" }] };
      },
    } as unknown as Pool;

    await expect(resetDatabase(development)).rejects.toThrow('Refusing to reset "fdeprep"');
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatch(/current_database\(\)/);
  });

  it("runs against a database named for tests", async () => {
    // In a cloud session DATABASE_URL names the development database, so this
    // holds only because vitest.config.ts hands the suite TEST_DATABASE_URL.
    const { rows } = await db().query<{ name: string }>("select current_database() as name");
    expect(rows[0]!.name).toMatch(/_test$/);
  });
});
