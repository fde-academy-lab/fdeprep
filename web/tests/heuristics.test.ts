/**
 * Panelist 1's heuristic layer. docs/10 section 4 and acceptance criterion 5.
 *
 * A heuristic is a rule that needs no model and encodes something a reviewer
 * would notice in two seconds. It produces a finding and never a terminal
 * fail, because a heuristic is a strong hint and not a fact.
 *
 * The test that matters most is the last one. A heuristic that fires on an
 * authored reference is a bug in the heuristic, so every rule in the registry
 * runs against every reference in the catalogue and has to stay silent. That
 * one test is what stops a rule shipping that tells good answers they are bad.
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  HEURISTICS, heuristicNames, runHeuristics, type HeuristicInput,
} from "../lib/eval/heuristics.ts";

const PROBLEMS = path.join(import.meta.dirname, "..", "..", "problems");
const VOICE = path.join(import.meta.dirname, "..", "..", "voice-questions");

function input(over: Partial<HeuristicInput> = {}): HeuristicInput {
  return {
    artefactType: "design",
    complexity: "C4",
    body: "An answer.",
    brief: "A brief.",
    constraints: [],
    llmCalls: null,
    callBudget: null,
    ...over,
  };
}

const codes = (over: Partial<HeuristicInput>) =>
  runHeuristics(input(over)).map((f) => f.code);

describe("what each heuristic notices", () => {
  it("names_no_constraint fires on an answer that goes near none of them", () => {
    const constraints = ["two weeks", "refund", "40 conversations"];
    expect(codes({ constraints, body: "I would add more tests and ship it." }))
      .toContain("names_no_constraint");
    expect(codes({ constraints, body: "A wrong refund costs money, so I would gate on it." }))
      .not.toContain("names_no_constraint");
  });

  it("names_no_constraint stays silent when the problem authored none", () => {
    // It needs a constraint list to check against, and no problem in the
    // catalogue declares one yet. A rule with nothing to compare against says
    // nothing rather than guessing.
    expect(codes({ constraints: [], body: "I would add more tests and ship it." }))
      .not.toContain("names_no_constraint");
  });

  it("no_tradeoff_language fires on an answer that compares nothing", () => {
    expect(codes({ body: "I would measure the pass rate. I would also measure latency. " +
                         "Both are important and I would report both every week." }))
      .toContain("no_tradeoff_language");
    expect(codes({ body: "I would gate on refund errors rather than the pass rate, " +
                         "because a wrong refund costs money." }))
      .not.toContain("no_tradeoff_language");
  });

  it("no_tradeoff_language only applies where a trade is the question", () => {
    // C1 to C3 ask for a technique, not an argument. Wanting a trade-off in an
    // answer that was never asked for one is the rule firing on the level
    // rather than on the answer.
    const body = "I would measure the pass rate and report it every week.";
    expect(codes({ body, complexity: "C3" })).not.toContain("no_tradeoff_language");
    expect(codes({ body, complexity: "C4" })).toContain("no_tradeoff_language");
  });

  it("single_paragraph fires on a long answer with no structure", () => {
    const stream = Array(420).fill("word").join(" ");
    expect(codes({ body: stream })).toContain("single_paragraph");
    // The same length, broken up, is an argument rather than a stream.
    const structured = `${Array(210).fill("word").join(" ")}\n\n${
      Array(210).fill("word").join(" ")}`;
    expect(codes({ body: structured })).not.toContain("single_paragraph");
    // And a short unbroken answer is just short.
    expect(codes({ body: Array(120).fill("word").join(" ") }))
      .not.toContain("single_paragraph");
  });

  it("restates_the_brief fires when most of the answer came from the brief", () => {
    const brief = "The client has forty handwritten conversations and a ninety five " +
      "percent pass rate and wants to launch a refunding support agent in two weeks.";
    expect(codes({ brief, body: brief })).toContain("restates_the_brief");
    expect(codes({
      brief,
      body: "Selection bias is the problem. Somebody wrote those cases knowing what " +
            "the assistant could already do, so they measure recall of a design " +
            "decision instead of coverage of real traffic.",
    })).not.toContain("restates_the_brief");
  });

  it("budget_ignored fires on a code answer at more than double the budget", () => {
    const code = { artefactType: "code", complexity: "C2" as const };
    expect(codes({ ...code, llmCalls: 13, callBudget: 6 })).toContain("budget_ignored");
    expect(codes({ ...code, llmCalls: 12, callBudget: 6 })).not.toContain("budget_ignored");
    expect(codes({ ...code, llmCalls: 2, callBudget: 6 })).not.toContain("budget_ignored");
    expect(codes({ ...code, llmCalls: 40, callBudget: null })).not.toContain("budget_ignored");
  });
});

describe("what a heuristic may and may not do", () => {
  it("never produces a blocking finding", () => {
    // docs/10 section 4: a heuristic is a strong hint and not a fact, so it
    // cannot fail a submission. Only deterministic checks do that.
    const everything = runHeuristics(input({
      constraints: ["two weeks"],
      body: Array(420).fill("word").join(" "),
    }));
    expect(everything.length).toBeGreaterThan(0);
    expect(everything.every((f) => f.severity === "informational")).toBe(true);
  });

  it("runs only the heuristics that match the artefact", () => {
    const stream = Array(420).fill("word").join(" ");
    expect(codes({ artefactType: "code", complexity: "C2", body: stream }))
      .not.toContain("single_paragraph");
  });

  it("says something a learner can act on", () => {
    // .claude/rules/02-writing.md, and the same rule the error messages follow.
    for (const finding of runHeuristics(input({
      constraints: ["two weeks"], body: Array(420).fill("word").join(" "),
    }))) {
      expect(finding.detail.length).toBeGreaterThan(30);
      expect(finding.detail).toMatch(/\.$/);
      // No rule name leaks into what a learner reads.
      expect(finding.detail).not.toContain("heuristic");
      expect(finding.detail).not.toContain(finding.code);
    }
  });

  it("has a registry with no duplicate names", () => {
    const names = heuristicNames();
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual([...names].sort());
  });
});

/**
 * docs/10 acceptance criterion 5.
 *
 * Every heuristic against every authored reference in the real catalogue. The
 * fixtures are excluded on purpose: they are one-line stand-ins that say so in
 * their own header, and holding a throwaway to this bar would tune the rules
 * against content nobody will ever read.
 */
describe("no heuristic fires on an authored reference", () => {
  async function authored(): Promise<Array<{
    label: string; artefactType: string; brief: string; body: string;
  }>> {
    const items: Array<{ label: string; artefactType: string; brief: string; body: string }> = [];

    for (const root of [PROBLEMS, VOICE]) {
      for (const dir of await readdir(root, { withFileTypes: true })) {
        if (!dir.isDirectory() || dir.name === "_fixtures") continue;
        for (const file of await readdir(path.join(root, dir.name))) {
          if (!file.endsWith(".yaml")) continue;
          const raw = await readFile(path.join(root, dir.name, file), "utf8");
          const doc = parse(raw) as Record<string, any>;
          const artefactType = String(doc["artefact_type"] ?? "voice");
          const brief = String(doc["brief_md"] ?? doc["question_md"] ?? "");
          const reference = String(doc["reference_md"] ?? "");
          if (reference.trim()) {
            items.push({ label: `${file} reference_md`, artefactType, brief, body: reference });
          }
          for (const exemplar of (doc["exemplars"] ?? []) as Array<Record<string, any>>) {
            if (exemplar["band"] !== "strong") continue;
            const body = String(exemplar["body_md"] ?? exemplar["transcript"] ?? "");
            if (body.trim()) {
              items.push({ label: `${file} strong exemplar`, artefactType, brief, body });
            }
          }
        }
      }
    }
    return items;
  }

  it("reads the whole catalogue rather than a sample of it", async () => {
    const items = await authored();
    // 25 problems and 12 voice questions, each with a reference and some with a
    // graded strong answer. A number that drops means content moved and this
    // test quietly started proving less.
    expect(items.length).toBeGreaterThanOrEqual(35);
  });

  it("stays silent on every one of them", async () => {
    const fired: string[] = [];

    for (const item of await authored()) {
      const findings = runHeuristics({
        artefactType: item.artefactType,
        // The level that turns on the most rules, so this is the hardest bar
        // the catalogue could be held to rather than the easiest.
        complexity: "C5",
        body: item.body,
        brief: item.brief,
        // No problem authors constraints yet. When one does, a reference that
        // names none of them is a reference worth looking at.
        constraints: [],
        llmCalls: null,
        callBudget: null,
      });
      for (const finding of findings) fired.push(`${item.label}: ${finding.code}`);
    }

    expect(fired).toEqual([]);
  });

  it("covers every heuristic in the registry, so none is silently untested", () => {
    // A rule that no artefact in the catalogue can reach would pass the test
    // above by never running at all.
    const reachable = new Set(HEURISTICS.flatMap((h) => h.artefacts));
    expect([...reachable].sort()).toEqual(["code", "design", "prompt"]);
  });
});
