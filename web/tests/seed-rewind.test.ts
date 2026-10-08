/**
 * The seed's rewind. Bolt 3 of the seed brief.
 *
 * The one place the seed sets a timestamp by hand, so the one place it could
 * set something else by hand. Two guards: the allowlist holds moments and
 * nothing that grades, and a rewind naming any other column does not compile
 * (the @ts-expect-error lines below fail `npm run typecheck` the day that
 * stops being true).
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../lib/db/pool.ts";
import { now, REWIND, rewindRows, rewindWindow } from "../lib/seed/rewind.ts";
import { createSubmission } from "../lib/submissions/create.ts";
import { importFixtures, resetDatabase, seedLearner } from "./helpers.ts";

const DAY = 86_400_000;

let learner: Awaited<ReturnType<typeof seedLearner>>;

beforeEach(async () => {
  await resetDatabase();
  await importFixtures();
  learner = await seedLearner();
});

afterAll(async () => {
  await closeDb();
});

async function problemId(slug: string): Promise<number> {
  const { rows } = await db().query<{ id: string }>("select id from problem where slug = $1", [slug]);
  return Number(rows[0]!.id);
}

async function run(slug = "echo-the-question", body = "def run_agent(q, llm, tools): return q") {
  return createSubmission({
    enrolmentId: learner.enrolmentId, cohortId: learner.cohortId,
    problemId: await problemId(slug), kind: "run", body,
  });
}

describe("what the rewind may touch", () => {
  it("names moments and nothing that grades", () => {
    for (const [table, columns] of Object.entries(REWIND)) {
      for (const column of columns) {
        expect(column, `${table}.${column}`).toMatch(/_at$|^window_start$/);
        expect(column, `${table}.${column}`).not.toMatch(/^(verdict|score|band|state)$|_score$/);
      }
    }
  });

  it("refuses any other column at compile time", async () => {
    // @ts-expect-error verdict is not a moment, so it is not on the list.
    await rewindRows(db(), "submission", [], 1, ["verdict"]);
    // @ts-expect-error competency cells are not on the list at all.
    await rewindRows(db(), "competency_score", [], 1, ["updated_at"]);
    // @ts-expect-error the voice score is not a moment.
    await rewindRows(db(), "voice_session", [], 1, ["score"]);
  });
});

describe("rewindWindow", () => {
  it("moves the rows written in the window, whole, and leaves older rows alone", async () => {
    const older = await run();
    const before = await db().query<{ queued_at: Date }>(
      "select queued_at from submission where id = $1", [older.id]);

    const from = await now(db());
    // Another problem, so the run opens a counter window of its own.
    const fresh = await run("bound-the-agent-loop");
    const to = await now(db());
    const born = await db().query<{ queued_at: Date }>(
      "select queued_at from submission where id = $1", [fresh.id]);

    await rewindWindow(db(), { from: from.at, to: to.at }, 3 * DAY);

    const { rows } = await db().query<{ id: string; queued_at: Date }>(
      "select id, queued_at from submission order by id");
    expect(rows[0]!.queued_at).toEqual(before.rows[0]!.queued_at);
    expect(born.rows[0]!.queued_at.getTime() - rows[1]!.queued_at.getTime()).toBe(3 * DAY);

    // The counter the run opened moved with it, so the next simulated day
    // opens a fresh window, and the older run's window stayed where it was.
    const counters = await db().query<{ problem_id: string; window_start: Date }>(
      `select problem_id, window_start from rate_limit_counter
        where enrolment_id = $1 and scope = 'run_hourly'`, [learner.enrolmentId]);
    const moved = counters.rows.filter((c) => Date.now() - c.window_start.getTime() > 2 * DAY);
    expect(moved.map((c) => Number(c.problem_id))).toEqual([await problemId("bound-the-agent-loop")]);
    expect(counters.rows).toHaveLength(2);
  });

  it("moves a moment set in the window on a row born before it", async () => {
    const opened = await run();
    const { rows: attempt } = await db().query<{ first_opened_at: Date }>(
      "select first_opened_at from attempt where id = $1", [opened.attemptId]);

    const from = await now(db());
    await db().query("update attempt set solved_at = now() where id = $1", [opened.attemptId]);
    const to = await now(db());
    await rewindWindow(db(), { from: from.at, to: to.at }, DAY);

    const { rows } = await db().query<{ first_opened_at: Date; solved_at: Date }>(
      "select first_opened_at, solved_at from attempt where id = $1", [opened.attemptId]);
    expect(rows[0]!.first_opened_at).toEqual(attempt[0]!.first_opened_at);
    expect(Date.now() - rows[0]!.solved_at.getTime()).toBeGreaterThan(DAY - 60_000);
  });
});

describe("rewindRows", () => {
  it("moves only the named moments of the named rows", async () => {
    const one = await run();
    const two = await run("echo-the-question", "def run_agent(q, llm, tools): return q.lower()");
    const before = await db().query<{ id: string; queued_at: Date; started_at: Date | null }>(
      "select id, queued_at, started_at from submission order by id");

    await rewindRows(db(), "submission", [one.id], 60_000, ["queued_at"]);

    const after = await db().query<{ id: string; queued_at: Date; started_at: Date | null }>(
      "select id, queued_at, started_at from submission order by id");
    expect(before.rows[0]!.queued_at.getTime() - after.rows[0]!.queued_at.getTime()).toBe(60_000);
    expect(after.rows[1]).toEqual(before.rows[1]);
    expect(two.id).toBe(Number(after.rows[1]!.id));
  });
});
