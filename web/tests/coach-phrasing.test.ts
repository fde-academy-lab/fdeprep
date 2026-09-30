/**
 * Coach patterns read the answer's words, so a pattern written around one
 * phrasing nags a right answer written in another. On 30 September 2026 four
 * design coaches fired on their own problem's walkthrough, and one noticed a
 * claimed root cause only when "root cause" came first. These pin the fixes.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { firing, NEUTRAL } from "../lib/coach/engine.ts";
import { validateProblemYaml } from "../lib/problems/validate.ts";

const PROBLEMS = path.join(import.meta.dirname, "..", "..", "problems");

async function fired(problem: string, answer: string): Promise<string[]> {
  const file = path.join(PROBLEMS, `${problem}.yaml`);
  const coach = validateProblemYaml(await readFile(file, "utf8"), file).problem!.kit.coach!;
  return firing(coach, { ...NEUTRAL, code: answer }).map((s) => s.id);
}

const INCIDENT = "production/explain-an-incident-from-half-the-traces";

describe("a claimed root cause", () => {
  it("is noticed whichever way round the sentence runs", async () => {
    for (const claim of [
      "The root cause was the gateway release.",
      "The gateway release was the root cause.",
      "Root cause: the gateway release.",
      "The missing bookings were caused by the gateway release.",
    ]) {
      expect(await fired(INCIDENT, claim), claim).toContain("claims-a-cause");
    }
  });

  it("is left alone when the answer calls it a hypothesis", async () => {
    const answer = "The gateway release was the root cause, as a hypothesis the logs can test.";
    expect(await fired(INCIDENT, answer)).not.toContain("claims-a-cause");
  });
});

describe("an update that gives times", () => {
  it("is not asked for a time, however it words one", async () => {
    for (const time of [
      "The gateway team reports by 14:00.",
      "The gateway team reports at 14:00.",
      "The replay finishes before 3 pm.",
      "We will have the replay within two hours.",
      "The board hears the result by end of day.",
    ]) {
      expect(await fired(INCIDENT, time), time).not.toContain("no-times");
    }
  });
});

describe("a correct design in words the author did not expect", () => {
  it("is not told overfitting is the wrong mechanism when it says nothing was trained", async () => {
    const answer = "Calling it overfitting sends the fix the wrong way, because nothing was trained.";
    expect(await fired("evals/design-a-holdout-that-does-not-leak", answer))
      .not.toContain("wrong-mechanism");
  });

  it("is not asked for a boundary check when it checks for twins before each release", async () => {
    const answer = "Before each release a check looks for a holdout case with a twin in the prompt.";
    expect(await fired("evals/design-a-holdout-that-does-not-leak", answer))
      .not.toContain("no-boundary-check");
  });

  it("is not told it kept one model when the model is chosen per step", async () => {
    const answer = "The engineer wants the largest model for every step. " +
      "I would keep the model chosen per step in configuration.";
    expect(await fired("fde-practice/answer-the-engineer-who-wants-the-largest-model", answer))
      .not.toContain("one-model");
  });

  it("is not told it still depends on a hosted model when it runs one on-prem", async () => {
    const answer = "We replace the hosted model with one we run on-prem.";
    expect(await fired("fde-practice/ship-into-a-network-with-no-internet", answer))
      .not.toContain("hosted-model-kept");
  });
});
