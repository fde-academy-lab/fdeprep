/**
 * The tools the agent has, one case worked in the open, and the traps the
 * hidden cases catch: what a problem page spells out so a learner does not
 * have to piece it together from the brief. docs/04 section 2.1, as amended
 * 30 September 2026.
 *
 * Hidden means unpublished (CLAUDE.md), so every check here that reads the
 * hidden battery exists to keep it off the page.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { pythonLiteral } from "../components/workspace/problem-extras.tsx";
import { trapsVisible } from "../lib/policy/traps.ts";
import { SCREEN_CONDITIONS, TIERS } from "../lib/policy/tiers.ts";
import { publishableYamlFiles } from "../lib/problems/source.ts";
import { validateProblemYaml } from "../lib/problems/validate.ts";

const PROBLEMS = path.join(import.meta.dirname, "..", "..", "problems");

const test = (name: string, visibility: string, input: string, tools = "") => `
  - name: ${name}
    visibility: ${visibility}
    spec:
      kind: agent_run
      input: { question: "${input}" }
      llm_script: [{ match: "*", reply: "Final Answer: x" }]
      ${tools}
      assertions: [{ type: returns_nonempty }]`;

const problem = (extra: string, tools = "tools: { lookup: { returns: { status: 200 } } }") => `
slug: a-problem
title: A problem
day: 1
skill: Practise one thing
artefact_type: code
difficulty: easy
track: agent-loop
est_minutes: 20
call_budget: 6
competencies: [{ slug: agent-loop, weight: 1.0 }]
brief_md: A situation someone is in.
stub_code: |
  def run_agent(question, llm, tools):
      pass
tests:${test("p1", "public", "What plan is account 118 on?", tools)}${test("p2", "public", "q", tools)}${
  test("h1", "hidden", "Close account 77 and tell me when it is done", tools)}${test("h2", "hidden", "q", tools)}
complexity: C2
interview_evidence: { round: written, asked_as: "How do you stop a loop?", source: author judgement }
${extra}`;

const rules = (source: string) =>
  validateProblemYaml(source, "a.yaml").errors.map((e) => `${e.rule}: ${e.message}`);

describe("the tool list", () => {
  it("passes when it names exactly the tools the cases script", () => {
    const report = validateProblemYaml(problem(`
tools:
  - { name: lookup, args: account_id, returns: "The account's plan, or an error body when the id is unknown." }`),
    "a.yaml");
    expect(report.errors).toEqual([]);
    expect(report.problem!.kit.tools).toEqual([{ name: "lookup", args: "account_id",
      returns: "The account's plan, or an error body when the id is unknown." }]);
  });

  it("refuses a list that leaves out a scripted tool or names one no case scripts", () => {
    const missing = rules(problem("tools: []"));
    expect(missing.join("\n")).toMatch(/kit_tools: .*Missing: lookup/);
    const extra = rules(problem(`
tools:
  - { name: lookup, args: id, returns: A plan. }
  - { name: notify, args: user, returns: Nothing. }`));
    expect(extra.join("\n")).toMatch(/kit_tools: .*Only hidden cases use, or no case scripts: notify/);
  });
});

describe("a tool only the hidden battery uses", () => {
  const withHiddenTool = (brief: string, listed: string) => problem(`
tools:
  - { name: lookup, args: account_id, returns: A plan. }${listed}`)
    .replace("brief_md: A situation someone is in.", `brief_md: ${brief}`)
    .replace(/(- name: h1[\s\S]*?tools: \{ lookup: \{ returns: \{ status: 200 \} \})/,
             "$1, traffic: { returns: { rps: 9 } }");

  it("stays off the page, because listing it says what the hidden cases do", () => {
    expect(rules(withHiddenTool("A situation someone is in.", ""))).toEqual([]);
    expect(rules(withHiddenTool("A situation someone is in.",
                                "\n  - { name: traffic, args: service, returns: Load. }")).join("\n"))
      .toMatch(/kit_tools: .*Only hidden cases use, or no case scripts: traffic/);
  });

  it("may be listed when the brief already names it", () => {
    expect(rules(withHiddenTool("Check `traffic` before paging anyone.",
                                "\n  - { name: traffic, args: service, returns: Load. }"))).toEqual([]);
  });
});

describe("the worked example", () => {
  it("copies the input from the public case it names, so the page shows what the runner sends", () => {
    const report = validateProblemYaml(problem(`
example: { case: p1, expect: The agent looks the account up and names its plan. }`), "a.yaml");
    expect(report.problem!.kit.example).toEqual({
      kind: "case", case: "p1", input: { question: "What plan is account 118 on?" },
      expect: "The agent looks the account up and names its plan.",
    });
  });

  it("refuses a hidden case, which would publish it", () => {
    expect(rules(problem("example: { case: h1, expect: Anything. }")).join("\n"))
      .toMatch(/kit_example: example.case "h1" is not a public case/);
  });
});

describe("the traps", () => {
  it("refuses a trap that quotes a hidden case's input", () => {
    const report = rules(problem(`
traps:
  - "Failing to close account 77 and tell me when it is done."
  - Letting the loop run on after the model has answered.`));
    expect(report.join("\n")).toMatch(/kit_traps: traps\[0\] quotes a hidden case/);
  });

  it("refuses fewer than two or more than four", () => {
    expect(rules(problem("traps: [Only one trap here.]")).join("\n")).toMatch(/kit_traps: found 1 traps/);
  });

  it("shows before the attempt on Easy and Medium, and after it everywhere", () => {
    expect(trapsVisible(TIERS.easy, { solved: false, gaveUp: false })).toBe(true);
    expect(trapsVisible(TIERS.medium, { solved: false, gaveUp: false })).toBe(true);
    expect(trapsVisible(TIERS.hard, { solved: false, gaveUp: false })).toBe(false);
    expect(trapsVisible(TIERS.extreme, { solved: false, gaveUp: false })).toBe(false);
    expect(trapsVisible(SCREEN_CONDITIONS, { solved: false, gaveUp: false })).toBe(false);
    expect(trapsVisible(TIERS.extreme, { solved: true, gaveUp: false })).toBe(true);
    expect(trapsVisible(SCREEN_CONDITIONS, { solved: false, gaveUp: true })).toBe(true);
  });
});

describe("a Python literal for the example's input", () => {
  it("writes each value as Python would", () => {
    expect(pythonLiteral({ id: 7, ok: true, gone: null, tags: ["a", "b"] }))
      .toBe('{"id": 7, "ok": True, "gone": None, "tags": ["a", "b"]}');
  });
});

describe("across the catalogue", () => {
  it("every problem validates with its tools, its example and its traps", async () => {
    const files = await publishableYamlFiles(PROBLEMS);
    const kinds = { code: 0, prompt: 0, design: 0 } as Record<string, number>;
    for (const file of files) {
      const report = validateProblemYaml(await readFile(file, "utf8"), file, { requireKit: true });
      expect(report.errors, file).toEqual([]);
      const { kit, artefact_type } = report.problem!;
      kinds[artefact_type] = (kinds[artefact_type] ?? 0) + 1;
      expect(kit.traps?.length, file).toBeGreaterThanOrEqual(2);
      if (artefact_type !== "design") expect(kit.example, file).toBeDefined();
    }
    expect(kinds["code"]).toBeGreaterThan(0);
  });
});
