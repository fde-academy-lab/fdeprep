/**
 * Getting authored content into a database the application can reach.
 *
 * The admin import screen reads problems/ from disk when somebody clicks it,
 * which works on a machine holding the repository and cannot work on Vercel:
 * a build there traced 176 files for that route and none of the problem YAML,
 * and Next refuses an outputFileTracingIncludes glob that leaves the project
 * root. So publishing content is an operator command, run where the repository
 * already is.
 *
 * The voice half had no importer at all. The twelve questions were authored,
 * validated in CI and never loaded anywhere, so a deployed Voice Screen served
 * the docs/07 worked example and nothing else.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../lib/db/pool.ts";
import { importVoiceQuestion, VoiceImportRejected } from "../lib/voice/import.ts";
import {
  QuestionNotFound, VOICE_TRACK_ORDER, publishedQuestions, resolvePublishedQuestion,
} from "../lib/voice/question.ts";
import { fixtureQuestionId } from "../lib/voice/fixture.ts";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { importAllContent } from "../scripts/import-content.ts";
import { publishableYamlFiles } from "../lib/problems/source.ts";
import { resetDatabase } from "./helpers.ts";

const PROBLEMS = path.join(import.meta.dirname, "..", "..", "problems");

const quiet = () => {};

afterAll(async () => {
  await closeDb();
});

beforeEach(async () => {
  await resetDatabase();
});

/**
 * A whole-catalogue import takes time in proportion to the catalogue. At 92
 * problems it ran in 2.5 seconds on a laptop and past vitest's 5-second
 * default on the CI runner, and a timed-out import kept writing while the
 * next test truncated the tables, which Postgres reported as a deadlock. The
 * budget is for the catalogue's size; nothing here asserts on speed.
 */
const WHOLE_CATALOGUE = { timeout: 60_000 };

async function count(table: string): Promise<number> {
  const { rows } = await db().query<{ n: string }>(`select count(*) as n from ${table}`);
  return Number(rows[0]!.n);
}

describe("importing everything", WHOLE_CATALOGUE, () => {
  it("loads every catalogue problem and the fourteen voice questions", async () => {
    const report = await importAllContent(quiet);
    const catalogue = (await publishableYamlFiles(PROBLEMS)).length;

    expect(catalogue).toBeGreaterThanOrEqual(25);
    expect(report.problems).toBe(catalogue);
    expect(report.voiceQuestions).toBe(14);
    expect(await count("problem")).toBe(catalogue);
    expect(await count("voice_question")).toBe(14);
  });

  it("stores each problem's day, skill line and interview question for the page", async () => {
    await importAllContent(quiet);
    const { rows } = await db().query<{ no_day: string; no_skill: string; asked: string }>(
      `select count(*) filter (where p.day is null) as no_day,
              count(*) filter (where p.skill is null) as no_skill,
              count(*) filter (where v.interview->>'asked_as' <> '') as asked
         from problem p
         join problem_version v on v.problem_id = p.id and v.version = p.current_version`);
    // A drill has no day (docs/04 section 2.0); every other problem has one.
    const sources = await Promise.all((await publishableYamlFiles(PROBLEMS)).map((f) => readFile(f, "utf8")));
    expect(Number(rows[0]!.no_day)).toBe(sources.filter((s) => /^drill: true$/m.test(s)).length);
    expect(Number(rows[0]!.no_skill)).toBe(0);
    expect(Number(rows[0]!.asked)).toBe(await count("problem"));
  });

  it("leaves the fixtures out of both halves", async () => {
    await importAllContent(quiet);
    const { rows } = await db().query<{ slug: string }>(
      "select slug from problem where slug like '%echo%' or slug like '%bound-the-agent%'");
    expect(rows).toEqual([]);
  });

  it("can be run twice without doubling anything", async () => {
    // An operator reruns this after every content change, so the second run has
    // to be a no-op rather than a duplicate key error or a second copy.
    await importAllContent(quiet);
    const second = await importAllContent(quiet);

    expect(second.voiceQuestions).toBe(14);
    expect(await count("problem")).toBe((await publishableYamlFiles(PROBLEMS)).length);
    expect(await count("voice_question")).toBe(14);
  });
});

describe("a voice question", () => {
  const SOURCE = `slug: a-question
title: A question
track: agent-loop
difficulty: medium
total_seconds: 100
competencies: [agent-loop]
round: technical-deep-dive
tests: Whether you can name the mechanism that stops a loop.
interviewers: [engineering-lead]
builds_on: [stop-when-the-model-will-not]
prompt_text: |
  Say something.
framework:
  answer_first: Name the ceiling first.
  evidence: Give the number it would have cut.
  trade_off: Say what the ceiling costs.
  if_you_do_not_know: Say what you would measure first.
tips:
  - Say the mechanism before the monitoring.
  - Name the case the ceiling misses.
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

  it("writes its beats, rubric, follow-ups and exemplars", async () => {
    const id = await importVoiceQuestion(SOURCE, "a-question.yaml");

    expect(await count("voice_beat")).toBe(4);
    expect(await count("voice_rubric_criterion")).toBe(2);
    expect(await count("voice_follow_up")).toBe(1);
    // The rubric judge reads these. Without them a session scores against
    // nothing and the debrief has no band to anchor on.
    expect(await count("voice_exemplar")).toBe(3);

    const { rows } = await db().query<{ is_published: boolean; total_seconds: number }>(
      "select is_published, total_seconds from voice_question where id = $1", [id]);
    expect(rows[0]!.is_published).toBe(true);
    expect(rows[0]!.total_seconds).toBe(100);
  });

  it("keeps the beats in their authored order", async () => {
    await importVoiceQuestion(SOURCE, "a-question.yaml");
    const { rows } = await db().query<{ beat_key: string }>(
      "select beat_key from voice_beat order by ordinal");
    expect(rows.map((r) => r.beat_key)).toEqual(["b1", "b2", "b3", "b4"]);
  });

  it("updates in place when the file changes rather than making a second one", async () => {
    await importVoiceQuestion(SOURCE, "a-question.yaml");
    await importVoiceQuestion(SOURCE.replace("title: A question", "title: A better question"),
      "a-question.yaml");

    expect(await count("voice_question")).toBe(1);
    const { rows } = await db().query<{ title: string }>("select title from voice_question");
    expect(rows[0]!.title).toBe("A better question");
  });

  it("drops a beat the author renamed away, rather than keeping both", async () => {
    // Upserting on the key alone would leave b4 behind forever, and the cockpit
    // would render a segment nothing will ever cue. Renaming rather than
    // deleting, because four is the floor and three would fail validation,
    // which is the validator doing its job.
    await importVoiceQuestion(SOURCE, "a-question.yaml");
    await importVoiceQuestion(SOURCE.replace("id: b4, label: Four", "id: b5, label: Five"),
      "a-question.yaml");

    const { rows } = await db().query<{ beat_key: string }>(
      "select beat_key from voice_beat order by ordinal");
    expect(rows.map((r) => r.beat_key)).toEqual(["b1", "b2", "b3", "b5"]);
  });

  it("refuses a question that does not validate, naming the file", async () => {
    const broken = SOURCE.replace("weight: 40", "weight: 30");
    await expect(importVoiceQuestion(broken, "a-question.yaml"))
      .rejects.toThrow(VoiceImportRejected);
    expect(await count("voice_question")).toBe(0);
  });
});

describe("which question a learner gets", WHOLE_CATALOGUE, () => {
  it("is nothing at all before the content has been imported", async () => {
    // A fresh checkout has an empty table. The picker says to run
    // `npm run import:content`, and the session page sends a learner there
    // rather than filing an answer under the docs/07 fixture.
    await expect(publishedQuestions()).resolves.toEqual([]);
    await expect(resolvePublishedQuestion("say-no-to-the-date"))
      .rejects.toBeInstanceOf(QuestionNotFound);
  });

  it("is an authored question once it has, never the fixture", async () => {
    const fixture = await fixtureQuestionId();
    await importAllContent(quiet);

    const ids = (await publishedQuestions()).map((q) => q.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).not.toContain(fixture);

    // The fixture stays unpublished, which is what keeps it out of the way.
    const { rows } = await db().query<{ is_published: boolean }>(
      "select is_published from voice_question where id = $1", [fixture]);
    expect(rows[0]!.is_published).toBe(false);
  });

  it("honours a slug so a learner can be sent a particular question", async () => {
    await importAllContent(quiet);
    const id = await resolvePublishedQuestion("say-no-to-the-date");
    const { rows } = await db().query<{ slug: string }>(
      "select slug from voice_question where id = $1", [id]);
    expect(rows[0]!.slug).toBe("say-no-to-the-date");
  });

  it("keeps the picker's order across a second import", async () => {
    // Ordered by slug rather than id, so an import that renumbers rows does not
    // quietly change the order Next question walks.
    await importAllContent(quiet);
    const first = (await publishedQuestions()).map((q) => q.slug);
    await importAllContent(quiet);
    expect((await publishedQuestions()).map((q) => q.slug)).toEqual(first);
  });

  it("lists all fourteen for a picker, by track and then by slug", async () => {
    await importAllContent(quiet);
    const all = await publishedQuestions();
    expect(all).toHaveLength(14);
    const rank = (q: { track: string; slug: string }) =>
      `${VOICE_TRACK_ORDER.indexOf(q.track as never)}:${q.slug}`;
    expect(all.map(rank)).toEqual([...all.map(rank)].sort());
    expect(new Set(all.map((q) => q.track))).toEqual(new Set(VOICE_TRACK_ORDER));
  });
});
