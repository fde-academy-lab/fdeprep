/**
 * Phase 5 acceptance, criteria 1 and 2, and the standing rule that goes with
 * them: the persona changes the order of the roadmap and never changes who can
 * reach a problem.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../lib/db/pool.ts";
import { listProblems } from "../lib/problems/catalogue.ts";
import { nextUp, roadmapFor, seedTracks, SHAPES } from "../lib/policy/roadmap.ts";
import { importFixtures, resetDatabase, seedLearner } from "./helpers.ts";

const PERSONAS = ["builder", "navigator", "accelerator"] as const;

let learners: Record<string, { enrolmentId: number; cohortId: number; userId: number }>;

beforeEach(async () => {
  await resetDatabase();
  await importFixtures();
  await seedTracks();

  learners = {};
  for (const [index, persona] of PERSONAS.entries()) {
    learners[persona] = await seedLearner({ persona, githubId: 100 + index });
  }
});

afterAll(async () => {
  await closeDb();
});

describe("acceptance 1: three personas, three different Next Up sets", () => {
  it("gives each persona a different first three over the same catalogue", async () => {
    // Past the start card, which S2 shows instead of Next Up until the
    // learner has attempted something.
    for (const persona of PERSONAS) await startTrack(learners[persona]!);

    const sets = await Promise.all(PERSONAS.map(async (persona) =>
      (await nextUp(learners[persona]!.enrolmentId)).items.map((item) => item.slug)));

    for (const set of sets) expect(set).toHaveLength(3);
    // Three distinct orderings, not three copies of the catalogue's own order.
    expect(new Set(sets.map((s) => s.join(","))).size).toBe(3);
  });

  it("starts the builder on Easy, which is what the tier is for", async () => {
    const first = (await nextUp(learners["builder"]!.enrolmentId)).items[0]!;
    expect(first.difficulty).toBe("easy");
  });

  it("starts the navigator at Medium", async () => {
    const first = (await nextUp(learners["navigator"]!.enrolmentId)).items[0]!;
    expect(first.difficulty).toBe("medium");
  });

  it("starts the accelerator at Hard or above", async () => {
    const first = (await nextUp(learners["accelerator"]!.enrolmentId)).items[0]!;
    expect(["hard", "extreme"]).toContain(first.difficulty);
  });

  it("weights the navigator towards tool creation, memory and retrieval", async () => {
    const roadmap = await roadmapFor(learners["navigator"]!.enrolmentId);
    const required = roadmap.items.filter((item) => !item.isOptional).slice(0, 4);
    expect(required.map((item) => item.track))
      .toEqual(expect.arrayContaining(["tool-creation", "memory"]));
  });

  it("puts Extreme and design work at the front for the accelerator", async () => {
    const roadmap = await roadmapFor(learners["accelerator"]!.enrolmentId);
    const first = roadmap.items.filter((item) => !item.isOptional)[0]!;
    expect(["hard", "extreme"]).toContain(first.difficulty);
  });
});

describe("acceptance 2: every problem stays reachable for every persona", () => {
  it("shows the whole catalogue to all three personas", async () => {
    const { rows } = await db().query<{ count: string }>("select count(*) from problem");
    const total = Number(rows[0]!.count);

    for (const persona of PERSONAS) {
      const page = await listProblems({
        enrolmentId: learners[persona]!.enrolmentId, perPage: 100,
      });
      expect(page.total).toBe(total);
    }
  });

  it("keeps a problem reachable even when no track carries it", async () => {
    // docs/02 section 5: the catalogue reads from problem, never from
    // track_item. A problem nobody put on a roadmap is still practisable.
    await db().query("delete from track_item");
    const page = await listProblems({
      enrolmentId: learners["builder"]!.enrolmentId, perPage: 100,
    });
    const { rows } = await db().query<{ count: string }>("select count(*) from problem");
    expect(page.total).toBe(Number(rows[0]!.count));
  });

  it("puts every problem on at least one persona's roadmap", async () => {
    // Reachability is the catalogue's job. This is the weaker claim that the
    // seeding covered the catalogue rather than a corner of it.
    const seen = new Set<string>();
    for (const persona of PERSONAS) {
      const roadmap = await roadmapFor(learners[persona]!.enrolmentId);
      for (const item of roadmap.items) seen.add(item.slug);
    }
    const { rows } = await db().query<{ slug: string }>("select slug from problem");
    expect(seen.size).toBe(rows.length);
  });
});

describe("Next Up, per docs/01 S2", () => {
  it("shows exactly three cards", async () => {
    await startTrack(learners["builder"]!);
    expect((await nextUp(learners["builder"]!.enrolmentId)).items).toHaveLength(3);
  });

  it("skips a solved problem", async () => {
    await startTrack(learners["builder"]!);
    const before = await nextUp(learners["builder"]!.enrolmentId);
    const skipped = before.items[0]!;
    await markSolved(learners["builder"]!.enrolmentId, skipped.problemId);

    const after = await nextUp(learners["builder"]!.enrolmentId);
    expect(after.items.map((i) => i.slug)).not.toContain(skipped.slug);
    expect(after.items).toHaveLength(3);
  });

  it("offers a start card, not Next Up, to a learner with no attempts", async () => {
    const view = await nextUp(learners["builder"]!.enrolmentId);
    expect(view.kind).toBe("start");
    expect(view.items[0]!.difficulty).toBe("easy");
  });

  it("switches to Next Up once the learner has attempted something", async () => {
    const first = (await nextUp(learners["builder"]!.enrolmentId)).items[0]!;
    await recordAttempt(learners["builder"]!, first.problemId);
    expect((await nextUp(learners["builder"]!.enrolmentId)).kind).toBe("next_up");
  });

  it("holds the builder's off-ladder items back until the track is 60 percent done",
    async () => {
      // docs/00: for a Builder that off-ladder tier is Extreme, visible in the
      // catalogue throughout and joining the roadmap only once the runway is
      // mostly behind them. Which tier that is belongs to the policy module, so
      // this reads the shape rather than naming one.
      const ladder = SHAPES["builder"].ladder;
      const roadmap = await roadmapFor(learners["builder"]!.enrolmentId);
      const offLadder = roadmap.items.filter((i) => !ladder.includes(i.difficulty));
      expect(offLadder.length).toBeGreaterThan(0);
      expect(offLadder.every((i) => i.isOptional)).toBe(true);
      expect(roadmap.optionalUnlocked).toBe(false);

      const required = roadmap.items.filter((i) => !i.isOptional);
      const toSolve = Math.ceil(required.length * 0.6);
      for (const item of required.slice(0, toSolve)) {
        await markSolved(learners["builder"]!.enrolmentId, item.problemId);
      }
      expect((await roadmapFor(learners["builder"]!.enrolmentId)).optionalUnlocked).toBe(true);
    });

  it("runs out gracefully when everything is solved", async () => {
    const roadmap = await roadmapFor(learners["accelerator"]!.enrolmentId);
    for (const item of roadmap.items) {
      await markSolved(learners["accelerator"]!.enrolmentId, item.problemId);
    }
    const view = await nextUp(learners["accelerator"]!.enrolmentId);
    expect(view.kind).toBe("done");
    expect(view.items).toHaveLength(0);
  });
});

/** Record an attempt on the first roadmap item, so Next Up replaces the start card. */
async function startTrack(learner: { enrolmentId: number; cohortId: number }): Promise<void> {
  const roadmap = await roadmapFor(learner.enrolmentId);
  await recordAttempt(learner, roadmap.items[0]!.problemId);
}

async function markSolved(enrolmentId: number, problemId: number): Promise<void> {
  const { rows } = await db().query<{ cohort_id: string }>(
    "select cohort_id from enrolment where id = $1", [enrolmentId]);
  await db().query(
    `insert into attempt (enrolment_id, problem_id, cohort_id, solved_at)
     values ($1, $2, $3, now())
     on conflict (enrolment_id, problem_id) do update set solved_at = now()`,
    [enrolmentId, problemId, rows[0]!.cohort_id]);
}

async function recordAttempt(
  learner: { enrolmentId: number; cohortId: number }, problemId: number,
): Promise<void> {
  await db().query(
    `insert into attempt (enrolment_id, problem_id, cohort_id)
     values ($1, $2, $3) on conflict (enrolment_id, problem_id) do nothing`,
    [learner.enrolmentId, problemId, learner.cohortId]);
}
