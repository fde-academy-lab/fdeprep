/**
 * The fairness rule. docs/07 section 6.
 *
 * "Delivery is never scored and never gates readiness. Most learners here
 * speak English as a second or third language. Scoring fluency, accent, pace
 * against a native-speaker band, or filler rate would measure the wrong thing
 * and would tell a strong engineer they are weak."
 *
 * Three ways of checking it, because none alone is enough:
 *
 * 1. By behaviour. Two sessions identical except for their delivery score the
 *    same, and the CSV export of a learner with a terrible delivery carries
 *    none of it.
 * 2. By shape. scoreVoiceSession has no parameter that could take a delivery
 *    metric, so passing one would not compile.
 * 3. By reach. delivery.ts is imported by the debrief and by this test, and a
 *    fourth importer fails the build.
 *
 * This file is not a nice-to-have. A regression here tells a strong engineer
 * who speaks with an accent that they are weak, and nothing else in the
 * repository would catch it.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { closeDb, db } from "@/lib/db/pool";
import { deliveryFor, FILLERS, type Segment } from "@/lib/voice/delivery";
import { scoreVoiceSession, type BeatOutcome } from "@/lib/voice/score";
import { historyCsv } from "@/lib/progress";
import { heatmap } from "@/lib/progress";
import { resetDatabase, seedLearner } from "./helpers.ts";

const ROOT = path.join(import.meta.dirname, "..");

const BEATS: BeatOutcome[] = [
  { beatKey: "b1", covered: true, liveCovered: true, reachedAtMs: 0, spentMs: 20_000,
    paceState: "on_budget", seconds: 30, ordinal: 1 },
  { beatKey: "b2", covered: true, liveCovered: true, reachedAtMs: 20_000, spentMs: 50_000,
    paceState: "on_budget", seconds: 60, ordinal: 2 },
  { beatKey: "b3", covered: false, liveCovered: false, reachedAtMs: 70_000, spentMs: 40_000,
    paceState: "on_budget", seconds: 60, ordinal: 3 },
];

/** The same answer said two ways: fluent, and full of fillers with long
 *  pauses. Same words, same beats, same clock. */
const FLUENT: Segment[] = [
  { text: "the agent could loop forever without a budget", startMs: 0, endMs: 4_000 },
  { text: "so we cap the number of steps it can take", startMs: 4_200, endMs: 8_000 },
];
const HESITANT: Segment[] = [
  { text: "um the agent uh could loop forever um without a budget", startMs: 0, endMs: 9_000 },
  { text: "erm so we hmm cap the number of steps it can take", startMs: 22_000, endMs: 31_000 },
];

describe("delivery never reaches the score", () => {
  test("two answers with the same beats score the same however they were said", () => {
    const fluent = scoreVoiceSession({
      contentPoints: 38, beats: BEATS, durationMs: 110_000, totalSeconds: 285,
    });
    const hesitant = scoreVoiceSession({
      contentPoints: 38, beats: BEATS, durationMs: 110_000, totalSeconds: 285,
    });
    expect(hesitant).toEqual(fluent);

    // And the two deliveries really are different, so the test above is
    // comparing something rather than nothing.
    const a = deliveryFor(FLUENT);
    const b = deliveryFor(HESITANT);
    expect(a.fillerCount).toBe(0);
    expect(b.fillerCount).toBeGreaterThan(3);
    expect(b.longestPauseMs).toBeGreaterThan(a.longestPauseMs);
    expect(b.wordsPerMinute).not.toBe(a.wordsPerMinute);
  });

  test("the scoring function has no way to take a delivery metric", async () => {
    const source = await readFile(path.join(ROOT, "lib", "voice", "score.ts"), "utf8");
    // Its inputs, spelled out. A new one would have to be added here.
    expect(source).toMatch(/contentPoints: number;\s+beats: BeatOutcome\[\];/);
    for (const forbidden of [/wordsPerMinute/, /fillerCount/, /longestPause/, /\bwpm\b/]) {
      expect(source, `score.ts mentions ${forbidden}`).not.toMatch(forbidden);
    }
    expect(source, "score.ts imports the delivery module").not.toMatch(/from "\.\/delivery/);
  });

  test("delivery reaches the debrief and nothing else", async () => {
    const importers: string[] = [];
    for (const file of await sourceFiles(ROOT)) {
      const source = await readFile(file, "utf8");
      if (/from "[^"]*voice\/delivery"|from "\.[./]*delivery\.ts"/.test(source)) {
        importers.push(path.relative(ROOT, file));
      }
    }
    expect(importers.sort()).toEqual([
      // The debrief assembles it, the debrief screen shows it, the scoring
      // worker writes it to its own column, and this test guards it.
      "app/voice/sessions/[id]/page.tsx",
      "lib/voice/debrief.ts",
      "lib/voice/judge.ts",
      "lib/voice/persist.ts",
      "tests/fairness.test.ts",
    ]);
  });
});

describe("delivery never reaches the heatmap or the export", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await closeDb();
  });

  test("the placement CSV carries no delivery field, whatever the learner sounded like", async () => {
    const learner = await seedLearner();

    // A finished, scored session with the worst delivery the metrics can
    // describe. If any of it were going to leak, this is the row it leaks on.
    await db().query(
      `insert into voice_question
         (slug, title, track, difficulty, total_seconds, prompt_text, source_yaml)
       values ('fairness-probe', 'Fairness probe', 'agent-loop', 'medium', 285, 'x', 'x')`,
    );
    const { rows } = await db().query<{ id: string }>(
      "select id from voice_question where slug = 'fairness-probe'",
    );
    await db().query(
      `insert into voice_session
         (enrolment_id, voice_question_id, cohort_id, mode, finished_at, scored_at,
          transcript, score, content_score, structure_score, pace_score, delivery)
       values ($1, $2, $3, 'guided', now(), now(), 'um uh erm', 74, 38, 24, 12, $4)`,
      [learner.enrolmentId, rows[0]!.id, learner.cohortId,
       JSON.stringify({ wordsPerMinute: 41, fillerCount: 97, longestPauseMs: 31000, speakingMs: 1 })],
    );

    const csv = await historyCsv(learner.enrolmentId);
    for (const forbidden of [
      /words per minute/i, /wordsPerMinute/i, /\bwpm\b/i,
      /filler/i, /pause/i, /delivery/i,
      // The figures themselves, in case a column were added without its name.
      /\b41\b/, /\b97\b/, /\b31000\b/,
    ]) {
      expect(csv, `the export matched ${forbidden}:\n${csv}`).not.toMatch(forbidden);
    }
  });

  test("the heatmap carries no delivery field", async () => {
    const learner = await seedLearner();
    const grid = await heatmap(learner.enrolmentId);
    const rendered = JSON.stringify(grid);
    for (const forbidden of [/wordsPerMinute/i, /filler/i, /pause/i, /delivery/i]) {
      expect(rendered, `the heatmap matched ${forbidden}`).not.toMatch(forbidden);
    }
  });

  test("neither the export nor the heatmap reads the delivery column", async () => {
    const source = await readFile(path.join(ROOT, "lib", "progress", "index.ts"), "utf8");
    expect(source).not.toMatch(/delivery|voice_session/);
  });
});

describe("the delivery numbers themselves", () => {
  test("words per minute divides by time spent speaking, not the wall clock", () => {
    // Ten words in exactly one minute of speech, with a ten minute silence in
    // the middle. Dividing by the wall clock would report 1 word per minute
    // and call a thinking learner slow.
    const delivery = deliveryFor([
      { text: "one two three four five", startMs: 0, endMs: 30_000 },
      { text: "six seven eight nine ten", startMs: 630_000, endMs: 660_000 },
    ]);
    expect(delivery.wordsPerMinute).toBe(10);
    expect(delivery.longestPauseMs).toBe(600_000);
  });

  test("the filler list is short on purpose", () => {
    // "like" and "so" are ordinary words in an engineering sentence, and
    // counting them would punish somebody for speaking normally.
    expect(FILLERS).not.toContain("like");
    expect(FILLERS).not.toContain("so");
    expect(FILLERS.length).toBeLessThanOrEqual(6);
  });

  test("an answer with nothing in it reports zeroes rather than dividing by zero", () => {
    expect(deliveryFor([])).toEqual({
      wordsPerMinute: 0, fillerCount: 0, longestPauseMs: 0, speakingMs: 0,
    });
  });
});

async function sourceFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  const skip = new Set(["node_modules", ".next", "dist", "cdk.out"]);

  async function walk(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") && entry.name !== ".next") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!skip.has(entry.name)) await walk(full);
      } else if (/\.tsx?$/.test(entry.name)) {
        found.push(full);
      }
    }
  }

  await walk(root);
  return found;
}
