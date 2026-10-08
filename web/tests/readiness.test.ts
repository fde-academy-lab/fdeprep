/**
 * The readiness signal. docs/12 section 2, and acceptance 1, 2 and 7 of
 * section 7. Written before lib/progress/readiness.ts.
 *
 *   readiness = clean cells / cells the learner's track requires
 *
 * The cells a track requires, as this repository can compute them: the
 * distinct (competency, difficulty) pairs over the problems on the learner's
 * persona track that the track does not mark optional. Over the fixture
 * catalogue that is, worked out by hand from the fixture YAML and from
 * SHAPES in lib/policy/roadmap.ts (a tier off a persona's ladder is optional):
 *
 *   builder, ladder Easy Medium Hard, 13 cells
 *     Easy    agent-loop, prompt-hardening
 *     Medium  tool-error-handling, tool-schema-design, agent-loop,
 *             prompt-construction, state-and-memory
 *     Hard    retrieval, context-assembly, prompt-hardening,
 *             prompt-construction, evaluation-design, failure-mode-analysis
 *
 *   navigator, ladder Medium Hard Extreme, 15 cells
 *     the five Medium and six Hard cells above, and at Extreme
 *     evaluation-design, client-communication, failure-mode-analysis,
 *     system-design
 *
 * run-a-langgraph-graph carries no competency, so it adds no cell.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db, inTransaction } from "../lib/db/pool.ts";
import { seedTracks } from "../lib/policy/roadmap.ts";
import { bandFor, readinessFor, readinessForMany } from "../lib/progress/readiness.ts";
import { SUBMISSIONS } from "./fixtures/heatmap.ts";
import { seedHandComputedAccount } from "./fixtures/seed-heatmap.ts";
import { importFixtures, resetDatabase, seedLearner } from "./helpers.ts";

beforeEach(async () => {
  await resetDatabase();
  await importFixtures();
  await seedTracks();
});

afterAll(async () => {
  await closeDb();
});

describe("acceptance 1: no attempts", () => {
  it("reads 0, with every count zero except untouched, which is everything required", async () => {
    const learner = await seedLearner({ persona: "builder" });
    expect(await readinessFor(learner.enrolmentId)).toEqual({
      percent: 0, band: "not_ready", clean: 0, passed: 0, attempted: 0, untouched: 13, required: 13,
    });
  });
});

describe("the hand-computed heatmap", () => {
  it("reads one clean cell of thirteen for a builder", async () => {
    // tests/fixtures/heatmap.ts: agent-loop at Easy is clean; state-and-memory
    // at Medium and evaluation-design and failure-mode-analysis at Hard are
    // passed; agent-loop and tool-schema-design at Medium are attempted. All
    // six are on the builder's track, so seven of thirteen are untouched, and
    // one in thirteen is 7 percent once floored.
    const learner = await seedLearner({ persona: "builder" });
    await seedHandComputedAccount(learner);
    expect(await readinessFor(learner.enrolmentId)).toEqual({
      percent: 7, band: "not_ready", clean: 1, passed: 3, attempted: 2, untouched: 7, required: 13,
    });
  });

  it("does not count the same clean cell for a navigator, whose track starts at Medium", async () => {
    // The Easy clean cell is off the navigator's ladder, so it neither counts
    // nor sits in the denominator. The five other cells are all on it.
    const learner = await seedLearner({ persona: "navigator" });
    await seedHandComputedAccount(learner);
    expect(await readinessFor(learner.enrolmentId)).toEqual({
      percent: 0, band: "not_ready", clean: 0, passed: 3, attempted: 2, untouched: 10, required: 15,
    });
  });

  it("reads 0 for a navigator whose only clean cell is Easy, with untouched equal to required", async () => {
    const learner = await seedLearner({ persona: "navigator" });
    await seedHandComputedAccount(learner, SUBMISSIONS.slice(0, 1));
    expect(await readinessFor(learner.enrolmentId)).toEqual({
      percent: 0, band: "not_ready", clean: 0, passed: 0, attempted: 0, untouched: 15, required: 15,
    });
  });
});

describe("acceptance 2: seventy percent made of Easy cells", () => {
  it("is developing, not screen_ready", async () => {
    // A builder whose track requires only the two Easy cells, both clean:
    // 100 percent, and not one clean cell at Hard or Extreme.
    const learner = await seedLearner({ persona: "builder" });
    await db().query(
      `update track_item set is_optional = true
        where track_id = (select id from track where persona = 'builder')
          and problem_id not in (select id from problem where slug in
                                 ('echo-the-question', 'check-what-reaches-the-model'))`);
    await seedHandComputedAccount(learner, [
      { note: "Clean at Easy.", slug: "echo-the-question", verdict: "pass", hintsUsed: 0, llmCalls: 2 },
      { note: "Clean at Easy.", slug: "check-what-reaches-the-model", verdict: "pass",
        hintsUsed: 0, llmCalls: 1 },
    ]);

    const readiness = await readinessFor(learner.enrolmentId);
    expect(readiness.percent).toBe(100);
    expect(readiness.band).toBe("developing");
  });

  it("bands by the docs/12 thresholds", () => {
    expect(bandFor(39, 1)).toBe("not_ready");
    expect(bandFor(40, 0)).toBe("developing");
    expect(bandFor(69, 1)).toBe("developing");
    expect(bandFor(70, 0)).toBe("developing");
    expect(bandFor(70, 1)).toBe("screen_ready");
  });
});

describe("acceptance 7: one number from one statement", () => {
  it("gives the same answer for one learner and for a cohort, in the same transaction", async () => {
    const builder = await seedLearner({ persona: "builder", githubId: 1 });
    const navigator = await seedLearner({ persona: "navigator", githubId: 2, cohortId: builder.cohortId });
    await seedHandComputedAccount(builder);
    await seedHandComputedAccount(navigator);

    await inTransaction(async (client) => {
      const many = await readinessForMany([builder.enrolmentId, navigator.enrolmentId], client);
      expect(await readinessFor(builder.enrolmentId, client)).toEqual(many.get(builder.enrolmentId));
      expect(await readinessFor(navigator.enrolmentId, client)).toEqual(many.get(navigator.enrolmentId));
      expect(many.size).toBe(2);
    });
  });

  it("answers an empty list with an empty map", async () => {
    expect((await readinessForMany([])).size).toBe(0);
  });
});
