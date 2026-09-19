/**
 * The launch voice set and the gate that checks it.
 *
 * Two halves. The twelve authored questions have to validate and have to match
 * the docs/07 section 11 distribution. The validator has to reject the things
 * it exists to reject, because a validator that only ever passes is a file
 * that runs in CI and tests nothing.
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateVoiceYaml } from "../lib/voice/validate-question.ts";

const ROOT = path.join(import.meta.dirname, "..", "..", "voice-questions");

async function files(): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(ROOT, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name.endsWith(".yaml")) {
      found.push(path.join(entry.parentPath ?? entry.path, entry.name));
    }
  }
  return found.sort();
}

async function loadAll() {
  return Promise.all(
    (await files()).map(async (file) => ({
      file,
      source: await readFile(file, "utf8"),
    })),
  );
}

/** A question that passes every rule, edited per test to break exactly one. */
const GOOD = `slug: a-question
title: A question
track: agent-loop
difficulty: medium
total_seconds: 100
competencies: [agent-loop]
prompt_text: |
  Say something.
beats:
  - { id: b1, label: One, seconds: 25, anchors: ["step budget"] }
  - { id: b2, label: Two, seconds: 25, anchors: ["degrade"] }
  - { id: b3, label: Three, seconds: 25, anchors: ["monitor"] }
  - { id: b4, label: Four, seconds: 25, anchors: ["repeated call"] }
follow_ups:
  - { trigger_after_beat: b2, text: Why? }
rubric:
  - { criterion_key: c1, label: Names the mechanism, weight: 60 }
  - { criterion_key: c2, label: Names what it misses, weight: 40 }
exemplars:
  - band: strong
    score: 90
    transcript: |
      There is a step budget, and the loop stops when it runs out.
      When it fires we degrade to a partial answer rather than stop dead.
      I would monitor the number of steps each run actually takes.
      The signal I care about most is a repeated call with identical arguments.
  - band: adequate
    score: 60
    transcript: |
      There is a limit on steps.
  - band: weak
    score: 25
    transcript: |
      It should stop eventually.
`;

function rulesFrom(source: string): string[] {
  return validateVoiceYaml(source, "t.yaml").errors.map((e) => e.rule);
}

describe("the authored launch set", () => {
  it("validates every question", async () => {
    for (const { file, source } of await loadAll()) {
      const report = validateVoiceYaml(source, file);
      expect(report.errors, path.basename(file)).toEqual([]);
      expect(report.ok).toBe(true);
    }
  });

  it("matches the docs/07 section 11 distribution", async () => {
    const counts: Record<string, number> = {};
    for (const { source } of await loadAll()) {
      const track = /^track: (.+)$/m.exec(source)?.[1]?.trim() ?? "";
      counts[track] = (counts[track] ?? 0) + 1;
    }
    expect(counts).toEqual({
      "agent-loop": 3,
      "tool-schema-design": 2,
      "evaluation-design": 2,
      "system-design": 2,
      "client-communication": 3,
    });
  });

  it("has twelve questions with unique slugs", async () => {
    const all = await loadAll();
    expect(all).toHaveLength(12);
    const slugs = all.map(({ source }) => /^slug: (.+)$/m.exec(source)?.[1]);
    expect(new Set(slugs).size).toBe(12);
  });

  // docs/07 section 6 reports delivery and scores none of it. The rubric is
  // where a delivery metric would reach the score, because the judge reads it.
  it("has no rubric criterion that mentions delivery", async () => {
    for (const { file, source } of await loadAll()) {
      const report = validateVoiceYaml(source, file);
      expect(report.errors.filter((e) => e.rule === "delivery_in_rubric")).toEqual([]);
    }
  });
});

describe("the validator", () => {
  it("accepts the good question", () => {
    expect(rulesFrom(GOOD)).toEqual([]);
  });

  it("rejects three beats and seven beats", () => {
    const three = GOOD.replace(
      '  - { id: b4, label: Four, seconds: 25, anchors: ["repeated call"] }\n', "");
    expect(rulesFrom(three)).toContain("beat_count");

    const seven = GOOD.replace(
      '  - { id: b4, label: Four, seconds: 25, anchors: ["repeated call"] }',
      '  - { id: b4, label: Four, seconds: 25, anchors: ["repeated call"] }\n' +
      '  - { id: b5, label: Five, seconds: 25, anchors: ["degrade"] }\n' +
      '  - { id: b6, label: Six, seconds: 25, anchors: ["degrade"] }\n' +
      '  - { id: b7, label: Seven, seconds: 25, anchors: ["degrade"] }');
    expect(rulesFrom(seven)).toContain("beat_count");
  });

  it("rejects an anchor the strong exemplar never says", () => {
    const drifted = GOOD.replace('anchors: ["step budget"]', 'anchors: ["circuit breaker"]');
    expect(rulesFrom(drifted)).toContain("anchor_not_in_exemplar");
  });

  it("accepts an anchor separated by punctuation in the transcript", () => {
    // The live cue engine normalises before matching, so "step budget" still
    // lights on "step, budget". The validator has to agree with it.
    const punctuated = GOOD.replace("There is a step budget,", "There is a step, budget,");
    expect(rulesFrom(punctuated)).toEqual([]);
  });

  it("rejects a beat with no anchors", () => {
    const bare = GOOD.replace('anchors: ["degrade"] }', "anchors: [] }");
    expect(rulesFrom(bare)).toContain("no_anchors");
  });

  it("rejects beat budgets that do not add up to the clock", () => {
    expect(rulesFrom(GOOD.replace("total_seconds: 100", "total_seconds: 200")))
      .toContain("total_seconds");
  });

  it("rejects a rubric that does not sum to 100", () => {
    expect(rulesFrom(GOOD.replace("weight: 40", "weight: 30"))).toContain("rubric_weights");
  });

  it("rejects a rubric criterion that scores delivery", () => {
    const filler = GOOD.replace(
      "label: Names the mechanism", "label: Speaks fluently without fillers");
    expect(rulesFrom(filler)).toContain("delivery_in_rubric");

    const pace = GOOD.replace(
      "label: Names what it misses", "label: Keeps to 140 words per minute");
    expect(rulesFrom(pace)).toContain("delivery_in_rubric");
  });

  it("rejects exemplar scores that do not descend", () => {
    expect(rulesFrom(GOOD.replace("score: 60", "score: 95"))).toContain("exemplar_scores");
  });

  it("rejects a missing band", () => {
    const noWeak = GOOD.replace(/  - band: weak[\s\S]*$/, "");
    expect(rulesFrom(noWeak)).toContain("exemplar_bands");
  });

  it("rejects a follow-up that fires after a beat that does not exist", () => {
    expect(rulesFrom(GOOD.replace("trigger_after_beat: b2", "trigger_after_beat: b9")))
      .toContain("follow_up_beat");
  });

  it("rejects a track outside the competency vocabulary", () => {
    expect(rulesFrom(GOOD.replace("track: agent-loop", "track: vibes")))
      .toContain("unknown_track");
  });

  it("rejects two beats sharing an id", () => {
    expect(rulesFrom(GOOD.replace("id: b2, label: Two", "id: b1, label: Two")))
      .toContain("duplicate_beat");
  });

  // docs/07 section 2 fixes the beats and section 6 the pace band. Nothing
  // connected them: a question could sum to its clock and still hand a third of
  // it to a beat the strong exemplar covers in three words.
  it("rejects a beat the exemplar barely covers against a quarter of the clock", () => {
    const thin = GOOD.replace(
      "I would monitor the number of steps each run actually takes.", "I would monitor.");
    expect(rulesFrom(thin)).toContain("beat_allocation");
  });

  it("rejects a beat holding most of the answer against a quarter of the clock", () => {
    const fat = GOOD.replace(
      "When it fires we degrade to a partial answer rather than stop dead.",
      "When it fires we degrade to a partial answer rather than stop dead, and " +
      "the reason that matters is that a caller who gets nothing has to decide " +
      "what to do with nothing, whereas a caller who gets the part we were sure " +
      "of can act on that part today and come back for the rest, which is the " +
      "difference between a system that degrades and a system that simply fails " +
      "in a way somebody downstream has to handle for you.");
    expect(rulesFrom(fat)).toContain("beat_allocation");
  });

  // The real bug this splitter was written around. One launch question opens
  // with a sentence saying "it is genuinely your call", an anchor of its fifth
  // beat, and a splitter that sends a sentence to whichever beat it mentions
  // credits the opening to beat five and leaves beat one with twelve words.
  it("does not send an opening sentence to a later beat whose anchor it mentions", () => {
    const early = GOOD.replace(
      "There is a step budget, and the loop stops when it runs out.",
      "There is a step budget, and the loop stops when it runs out.\n" +
      "      That is the kind of repeated call I mean.");
    expect(rulesFrom(early)).not.toContain("beat_allocation");
  });

  it("reports the line a failure happened on", () => {
    const report = validateVoiceYaml(
      GOOD.replace('anchors: ["monitor"]', 'anchors: ["kubernetes"]'), "t.yaml");
    const error = report.errors.find((e) => e.rule === "anchor_not_in_exemplar");
    expect(error?.line).toBeGreaterThan(1);
  });
});
