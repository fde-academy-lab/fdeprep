/**
 * Phase 5 acceptance 3 and 4: the four competency states, and the heatmap
 * matching a hand-computed result for a seeded account.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../lib/db/pool.ts";
import { attemptHistory, historyCsv, heatmap } from "../lib/progress/index.ts";
import { COMPETENCIES } from "../lib/problems/vocabulary.ts";
import { DIFFICULTIES } from "../lib/policy/tiers.ts";
import { importFixtures, resetDatabase, seedLearner } from "./helpers.ts";
import {
  EXPECTED, EXPECTED_CLEAN_CELLS, EXPECTED_UNTOUCHED, SUBMISSIONS,
  stateOf,
} from "./fixtures/heatmap.ts";
import { seedHandComputedAccount } from "./fixtures/seed-heatmap.ts";

let learner: Awaited<ReturnType<typeof seedLearner>>;

beforeEach(async () => {
  await resetDatabase();
  await importFixtures();
  learner = await seedLearner({ persona: "navigator" });
});

afterAll(async () => {
  await closeDb();
});

describe("acceptance 4: the heatmap matches the hand-computed fixture", () => {
  it("produces exactly the cells the fixture says it should", async () => {
    await seedHandComputedAccount(learner);
    const grid = await heatmap(learner.enrolmentId);

    // Flattened to "competency at tier is state" on both sides, so comparing
    // them never indexes a lookup by tier.
    const actual = grid.rows.flatMap((row) => row.cells
      .filter((cell) => cell.state !== "untouched")
      .map((cell) => `${row.slug} at ${cell.difficulty} is ${cell.state}`)).sort();

    const expected = Object.entries(EXPECTED).flatMap(([slug, cells]) =>
      Object.entries(cells).map(([tier, state]) => `${slug} at ${tier} is ${state}`)).sort();

    expect(actual).toEqual(expected);
  });

  it("leaves every cell the fixture calls untouched untouched", async () => {
    await seedHandComputedAccount(learner);
    const grid = await heatmap(learner.enrolmentId);

    for (const [slug, difficulty, why] of EXPECTED_UNTOUCHED) {
      expect(stateOf(grid, slug, difficulty), `${slug} at ${difficulty}: ${why}`)
        .toBe("untouched");
    }
  });

  it("counts one clean cell towards readiness", async () => {
    await seedHandComputedAccount(learner);
    const grid = await heatmap(learner.enrolmentId);
    expect(grid.cleanCells).toBe(EXPECTED_CLEAN_CELLS);
  });

  it("renders all thirteen competencies across all four tiers", async () => {
    await seedHandComputedAccount(learner);
    const grid = await heatmap(learner.enrolmentId);
    expect(grid.rows).toHaveLength(COMPETENCIES.length);
    for (const row of grid.rows) {
      expect(row.cells.map((cell) => cell.difficulty)).toEqual([...DIFFICULTIES]);
    }
  });

  it("shows an untouched grid for an account with no submissions", async () => {
    const grid = await heatmap(learner.enrolmentId);
    expect(grid.cleanCells).toBe(0);
    expect(grid.rows.every((row) =>
      row.cells.every((cell) => cell.state === "untouched"))).toBe(true);
  });
});

describe("acceptance 3: a pass with hints is passed, never clean", () => {
  it("holds for the two-hint pass in the fixture", async () => {
    await seedHandComputedAccount(learner);
    const grid = await heatmap(learner.enrolmentId);
    expect(stateOf(grid, "state-and-memory", "medium")).toBe("passed");
  });

  it("holds for one hint as well as two", async () => {
    await seedHandComputedAccount(learner, [{
      note: "one hint is still a hint",
      slug: "carry-state-across-turns", verdict: "pass", hintsUsed: 1, llmCalls: 1,
    }]);
    const grid = await heatmap(learner.enrolmentId);
    expect(stateOf(grid, "state-and-memory", "medium"))
      .toBe("passed");
    expect(grid.cleanCells).toBe(0);
  });

  it("never walks a clean cell back to passed", async () => {
    await seedHandComputedAccount(learner);
    const grid = await heatmap(learner.enrolmentId);
    expect(stateOf(grid, "agent-loop", "easy"))
      .toBe("clean");
  });
});

describe("an error verdict changes nothing", () => {
  it("leaves a competency untouched when its only submission errored", async () => {
    await seedHandComputedAccount(learner, [{
      note: "the runner died",
      slug: "survive-the-hostile-tool", verdict: "error", hintsUsed: 0, llmCalls: null,
    }]);
    const grid = await heatmap(learner.enrolmentId);
    expect(stateOf(grid, "system-design", "extreme"))
      .toBe("untouched");
  });

  it("does the same for a timeout", async () => {
    await seedHandComputedAccount(learner, [{
      note: "the runner timed out",
      slug: "survive-the-hostile-tool", verdict: "timeout", hintsUsed: 0, llmCalls: null,
    }]);
    const grid = await heatmap(learner.enrolmentId);
    expect(stateOf(grid, "system-design", "extreme"))
      .toBe("untouched");
  });
});

describe("attempt history and its CSV export", () => {
  it("lists one row per problem attempted, newest first", async () => {
    await seedHandComputedAccount(learner);
    const rows = await attemptHistory(learner.enrolmentId);
    // Five problems, six submissions: echo-the-question appears once.
    expect(rows).toHaveLength(5);
    expect(new Set(rows.map((r) => r.slug)).size).toBe(5);
  });

  it("carries the columns S9 names", async () => {
    await seedHandComputedAccount(learner);
    const row = (await attemptHistory(learner.enrolmentId))
      .find((r) => r.slug === "echo-the-question")!;
    expect(row.submits).toBe(2);
    expect(row.hintsUsed).toBe(3);
    expect(row.verdict).toBe("pass");
  });

  it("exports a CSV with a header and one line per attempt", async () => {
    await seedHandComputedAccount(learner);
    const csv = await historyCsv(learner.enrolmentId);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("date,problem,difficulty,verdict,submits,hints,budget,defence");
    expect(lines).toHaveLength(6);
  });

  it("quotes a title containing a comma, so the columns do not shift", async () => {
    await db().query(
      "update problem set title = 'Recover, then degrade' where slug = 'echo-the-question'");
    await seedHandComputedAccount(learner);
    const csv = await historyCsv(learner.enrolmentId);
    expect(csv).toContain('"Recover, then degrade"');
    for (const line of csv.trim().split("\n")) {
      expect(splitCsv(line)).toHaveLength(8);
    }
  });

  it("exports nothing but a header for an account with no attempts", async () => {
    expect((await historyCsv(learner.enrolmentId)).trim().split("\n")).toHaveLength(1);
  });
});

describe("the fixture itself", () => {
  it("names a reason for every submission, so a reader can check the arithmetic", () => {
    for (const submission of SUBMISSIONS) {
      expect(submission.note.length).toBeGreaterThan(10);
    }
  });
});

/** Minimal RFC 4180 split, enough to count columns in a quoted line. */
function splitCsv(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]!;
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { out.push(field); field = ""; }
    else field += char;
  }
  out.push(field);
  return out;
}
