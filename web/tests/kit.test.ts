/**
 * The problem kit: the scenario card, the system diagram, the approach map, the
 * coach script and the hint ladder that turn a brief into something a learner
 * can picture and get unstuck on. docs/04 section 2.
 *
 * Written before the validator. A kit that renders wrong in front of a learner
 * is the failure these rules exist to stop in CI instead.
 */
import { describe, expect, it } from "vitest";
import { validateProblemYaml } from "../lib/problems/validate.ts";

const BASE = `
slug: a-problem
title: A problem
artefact_type: code
difficulty: medium
track: agent-loop
est_minutes: 20
call_budget: 6
time_limit_s: 10
allowed_imports: [json, re]
competencies:
  - { slug: agent-loop, weight: 1.0 }
brief_md: |
  A situation someone is in.
contract_md: |
  run_agent(question, llm, tools) -> str
stub_code: |
  def run_agent(question, llm, tools):
      pass
tests:
  - name: p1
    visibility: public
    spec:
      kind: agent_run
      input: { question: "q" }
      llm_script: [{ match: "*", reply: "Final Answer: x" }]
      assertions: [{ type: returns_nonempty }]
  - name: p2
    visibility: public
    spec:
      kind: agent_run
      input: { question: "q" }
      llm_script: [{ match: "*", reply: "Final Answer: x" }]
      assertions: [{ type: returns_nonempty }]
  - name: h1
    visibility: hidden
    spec:
      kind: agent_run
      input: { question: "q" }
      llm_script: [{ match: "*", reply: "Final Answer: x" }]
      assertions: [{ type: returns_nonempty }]
  - name: h2
    visibility: hidden
    spec:
      kind: agent_run
      input: { question: "q" }
      llm_script: [{ match: "*", reply: "Final Answer: x" }]
      assertions: [{ type: returns_nonempty }]
complexity: C2
interview_evidence:
  round: written
  asked_as: "How do you stop a loop?"
  source: author judgement
`;

const KIT = `
hints:
  - Look at what the loop does when nothing ends it.
  - A budget is a number the loop checks, not a hope.
  - Count the model calls and stop at the budget with a message.
scenario:
  who: Support operations at a parcel carrier
  situation: The triage agent ran for eleven minutes on one ticket last Tuesday.
  stakes: Every stuck ticket holds a customer refund for a day.
  metrics:
    - { label: Longest run, value: 11 min }
    - { label: Tickets stuck, value: "37" }
diagram:
  title: Where the loop never ends
  caption: Nothing between the model and the next call counts anything.
  direction: lr
  nodes:
    - { id: user, label: Customer, kind: actor, tone: blue }
    - { id: agent, label: Agent loop, sub: calls the model again, kind: agent, tone: purple }
    - { id: model, label: Model, kind: model, tone: teal }
  edges:
    - { from: user, to: agent, label: question, step: 1 }
    - { from: agent, to: model, label: next step, step: 2 }
    - { from: model, to: agent, label: never says final, tone: danger }
approach:
  goal: Make the loop end on its own terms
  branches:
    - label: Count what costs money
      leaves: [every model call, every tool call]
    - label: Decide what stopping returns
      leaves: [a message the user can act on]
coach:
  opening: Start by finding the line that decides whether the loop goes round again.
  signals:
    - id: no-budget
      when: { code_lacks: "range\\\\(|budget|max_" }
      say: Nothing in this loop counts calls yet. Where would the count live?
    - id: hidden-failed
      when: { test_failed: h1 }
      say: The hidden case gives the model no reason to stop. What does your loop do then?
`;

const rules = (source: string, options?: { requireKit?: boolean }) =>
  validateProblemYaml(source, "a.yaml", options).errors.map((e) => e.rule);

const lineOf = (source: string, needle: string) =>
  source.split("\n").findIndex((line) => line.includes(needle)) + 1;

describe("a complete kit", () => {
  it("passes when every piece is present and well formed", () => {
    const report = validateProblemYaml(BASE + KIT, "a.yaml", { requireKit: true });
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("travels with the parsed problem so import can store it", () => {
    const report = validateProblemYaml(BASE + KIT, "a.yaml", { requireKit: true });
    const kit = report.problem!.kit;
    expect(kit.scenario?.who).toBe("Support operations at a parcel carrier");
    expect(kit.diagram?.nodes.map((n) => n.id)).toEqual(["user", "agent", "model"]);
    expect(kit.approach?.branches).toHaveLength(2);
    expect(kit.coach?.signals.map((s) => s.id)).toEqual(["no-budget", "hidden-failed"]);
  });
});

describe("which problems must carry one", () => {
  it("lets a test fixture go without a kit", () => {
    // The one-line stand-ins under problems/_fixtures exist to exercise the
    // pipeline, and holding them to the catalogue's bar would test nothing.
    expect(validateProblemYaml(BASE, "a.yaml").ok).toBe(true);
  });

  it("names every missing piece of a catalogue problem", () => {
    const report = validateProblemYaml(BASE, "a.yaml", { requireKit: true });
    const missing = report.errors.filter((e) => e.rule === "kit_missing").map((e) => e.message);
    expect(missing.join(" ")).toMatch(/scenario/);
    expect(missing.join(" ")).toMatch(/diagram/);
    expect(missing.join(" ")).toMatch(/approach/);
    expect(missing.join(" ")).toMatch(/coach/);
  });

  it("wants three to five hints on a catalogue problem", () => {
    const two = (BASE + KIT).replace(
      "  - Count the model calls and stop at the budget with a message.\n", "");
    expect(rules(two, { requireKit: true })).toContain("hint_count");
    const six = (BASE + KIT).replace("hints:\n",
      "hints:\n  - a\n  - b\n  - c\n");
    expect(rules(six, { requireKit: true })).toContain("hint_count");
  });

  it("wants starter code on every code problem, at every tier", () => {
    const bare = (BASE + KIT)
      .replace("stub_code: |\n  def run_agent(question, llm, tools):\n      pass\n", "")
      .replace("difficulty: medium", "difficulty: extreme");
    expect(rules(bare, { requireKit: true })).toContain("missing_stub");
  });

  it("wants the starter code to define the function the contract names", () => {
    const wrong = (BASE + KIT).replace("def run_agent(question, llm, tools):", "def solve(q):");
    expect(rules(wrong, { requireKit: true })).toContain("stub_signature");
  });

  it("lets an Extreme problem carry hints now", () => {
    // docs/00 section 3.2 as amended: hints exist at every tier and Extreme
    // gates them behind two failed runs and an approach note instead.
    const extreme = (BASE + KIT).replace("difficulty: medium", "difficulty: extreme");
    expect(rules(extreme, { requireKit: true })).not.toContain("hints_on_extreme");
  });
});

describe("the scenario card", () => {
  it("rejects a field too long to fit the card, on its own line", () => {
    const long = "x".repeat(400);
    const source = (BASE + KIT).replace(
      "situation: The triage agent ran for eleven minutes on one ticket last Tuesday.",
      `situation: ${long}`);
    const error = validateProblemYaml(source, "a.yaml", { requireKit: true })
      .errors.find((e) => e.rule === "kit_scenario");
    expect(error?.message).toMatch(/situation/);
    expect(error?.line).toBe(lineOf(source, `situation: ${long}`));
  });

  it("allows at most three metrics", () => {
    const four = (BASE + KIT).replace(
      "    - { label: Tickets stuck, value: \"37\" }\n",
      "    - { label: Tickets stuck, value: \"37\" }\n    - { label: a, value: b }\n" +
      "    - { label: c, value: d }\n");
    expect(rules(four, { requireKit: true })).toContain("kit_scenario");
  });
});

describe("the diagram", () => {
  it("rejects an edge that points at a node that does not exist", () => {
    const source = (BASE + KIT).replace(
      "- { from: model, to: agent, label: never says final, tone: danger }",
      "- { from: model, to: ghost, label: never says final, tone: danger }");
    const error = validateProblemYaml(source, "a.yaml", { requireKit: true })
      .errors.find((e) => e.rule === "kit_diagram");
    expect(error?.message).toMatch(/ghost/);
    expect(error?.line).toBe(lineOf(source, "to: ghost"));
  });

  it("rejects two nodes with the same id", () => {
    const source = (BASE + KIT).replace(
      "- { id: model, label: Model, kind: model, tone: teal }",
      "- { id: agent, label: Model, kind: model, tone: teal }");
    expect(rules(source, { requireKit: true })).toContain("kit_diagram");
  });

  it("rejects a node kind or tone the renderer cannot draw", () => {
    expect(rules((BASE + KIT).replace("kind: agent, tone: purple", "kind: robot, tone: purple"),
      { requireKit: true })).toContain("kit_diagram");
    expect(rules((BASE + KIT).replace("kind: model, tone: teal", "kind: model, tone: mauve"),
      { requireKit: true })).toContain("kit_diagram");
  });

  it("rejects a label too long for its box", () => {
    const source = (BASE + KIT).replace("label: Agent loop,", `label: ${"y".repeat(40)},`);
    expect(rules(source, { requireKit: true })).toContain("kit_diagram");
  });

  it("catches a comma that split an unquoted value into extra keys", () => {
    // YAML reads { sub: fix, rerun, then ship } as sub "fix" plus two empty
    // keys, so the box would say "fix" and nothing would complain. An unknown
    // key is the only trace the split leaves.
    const source = (BASE + KIT).replace(
      "sub: calls the model again,", "sub: fix, rerun, then ship,");
    const error = validateProblemYaml(source, "a.yaml", { requireKit: true })
      .errors.find((e) => e.rule === "kit_diagram");
    expect(error?.message).toMatch(/rerun/);
    expect(error?.message).toMatch(/quote/);
    expect(error?.line).toBe(lineOf(source, "then ship"));
  });

  it("catches an unknown key on an edge, a metric and a signal too", () => {
    const edge = (BASE + KIT).replace("label: question, step: 1", "label: ask, then wait, step: 1");
    expect(rules(edge, { requireKit: true })).toContain("kit_diagram");
    const metric = (BASE + KIT).replace("value: 11 min", "value: 11 min, peak");
    expect(rules(metric, { requireKit: true })).toContain("kit_scenario");
    const signal = (BASE + KIT).replace(
      "      when: { test_failed: h1 }\n", "      when: { test_failed: h1 }\n      tone: warm\n");
    expect(rules(signal, { requireKit: true })).toContain("kit_coach");
  });

  it("rejects a picture with more nodes than a reader takes in at a glance", () => {
    const many = Array.from({ length: 11 }, (_, i) => `    - { id: n${i}, label: N${i} }`).join("\n");
    const source = (BASE + KIT).replace(
      "    - { id: user, label: Customer, kind: actor, tone: blue }", many);
    expect(rules(source, { requireKit: true })).toContain("kit_diagram");
  });
});

describe("the approach map", () => {
  it("wants at least two branches, since one branch is a sentence", () => {
    const source = (BASE + KIT).replace(
      "    - label: Decide what stopping returns\n      leaves: [a message the user can act on]\n", "");
    expect(rules(source, { requireKit: true })).toContain("kit_approach");
  });

  it("rejects a leaf that is not text, which is what a colon inside a leaf produces", () => {
    const source = (BASE + KIT).replace(
      "leaves: [a message the user can act on]", "leaves: [retry: once]");
    expect(rules(source, { requireKit: true })).toContain("kit_approach");
  });
});

describe("the coach script", () => {
  it("rejects a signal with no condition, since it could never fire or always would", () => {
    const source = (BASE + KIT).replace(
      "      when: { test_failed: h1 }\n", "      when: {}\n");
    expect(rules(source, { requireKit: true })).toContain("kit_coach");
  });

  it("rejects a code pattern that does not compile, naming it", () => {
    const source = (BASE + KIT).replace(
      'code_lacks: "range\\\\(|budget|max_"', 'code_lacks: "range(("');
    const error = validateProblemYaml(source, "a.yaml", { requireKit: true })
      .errors.find((e) => e.rule === "kit_coach");
    expect(error?.message).toMatch(/range\(\(/);
  });

  it("rejects a signal keyed to a test the problem does not have", () => {
    const source = (BASE + KIT).replace("test_failed: h1", "test_failed: h9");
    const error = validateProblemYaml(source, "a.yaml", { requireKit: true })
      .errors.find((e) => e.rule === "kit_coach");
    expect(error?.message).toMatch(/h9/);
  });

  it("wants an opening line, which is what the coach says before anything happens", () => {
    const source = (BASE + KIT).replace(
      "  opening: Start by finding the line that decides whether the loop goes round again.\n", "");
    expect(rules(source, { requireKit: true })).toContain("kit_coach");
  });
});

describe("a stage of a build", () => {
  it("accepts a stage inside its build", () => {
    const source = BASE + KIT + "build: { id: support-copilot, title: A copilot, stage: 2, of: 5 }\n";
    expect(rules(source, { requireKit: true })).toEqual([]);
  });

  it("rejects a stage past the end of its build", () => {
    const source = BASE + KIT + "build: { id: support-copilot, title: A copilot, stage: 6, of: 5 }\n";
    expect(rules(source, { requireKit: true })).toContain("kit_build");
  });
});

describe("the track", () => {
  it("rejects a track outside the vocabulary, on its line", () => {
    const source = (BASE + KIT).replace("track: agent-loop", "track: vibes");
    const error = validateProblemYaml(source, "a.yaml", { requireKit: true })
      .errors.find((e) => e.rule === "unknown_track");
    expect(error?.line).toBe(lineOf(source, "track: vibes"));
  });

  it("accepts the tracks added with the catalogue expansion", () => {
    for (const track of ["structured-output", "guardrails", "production", "fde-practice", "builds"]) {
      const source = (BASE + KIT).replace("track: agent-loop", `track: ${track}`);
      expect(rules(source, { requireKit: true }), track).toEqual([]);
    }
  });
});
