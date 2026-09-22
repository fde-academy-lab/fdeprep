/**
 * Every rule in docs/04 section 1, plus the shadowing-matcher rule added in
 * the Phase 1 pull request. Each rejection must name the offending line,
 * because "invalid problem" with no line number sends an author hunting.
 */
import { describe, expect, it } from "vitest";
import { validateProblemYaml } from "../lib/problems/validate.ts";
import { COMPETENCIES } from "../lib/problems/vocabulary.ts";

const CODE = `
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
  asked_as: |
    A question in the words an interviewer would use.
  source: |
    Author judgement.
`;

/** Replace a line in the fixture so the expected line number stays predictable. */
function withLine(source: string, find: string, replace: string): string {
  if (!source.includes(find)) throw new Error(`fixture does not contain ${find}`);
  return source.replace(find, replace);
}

function lineOf(source: string, needle: string): number {
  const index = source.split("\n").findIndex((line) => line.includes(needle));
  if (index < 0) throw new Error(`no line contains ${needle}`);
  return index + 1;
}

describe("a valid problem", () => {
  it("passes with no errors", () => {
    const report = validateProblemYaml(CODE, "a.yaml");
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("returns the parsed problem for the importer to use", () => {
    const report = validateProblemYaml(CODE, "a.yaml");
    expect(report.problem?.slug).toBe("a-problem");
    expect(report.problem?.tests).toHaveLength(4);
  });
});

describe("docs/04 section 1 rules", () => {
  it("rejects an llm_script with no star fallback, naming the line", () => {
    const source = withLine(
      CODE,
      `llm_script: [{ match: "*", reply: "Final Answer: x" }]\n      assertions: [{ type: returns_nonempty }]\n  - name: p2`,
      `llm_script: [{ match: { contains: "zz" }, reply: "Final Answer: x" }]\n      assertions: [{ type: returns_nonempty }]\n  - name: p2`,
    );
    const report = validateProblemYaml(source, "a.yaml");
    const error = report.errors.find((e) => e.rule === "script_needs_fallback");
    expect(error).toBeDefined();
    expect(error!.line).toBe(lineOf(source, 'contains: "zz"'));
  });

  it("rejects a competency tag outside the fixed vocabulary", () => {
    const source = withLine(CODE, "slug: agent-loop, weight", "slug: vibes, weight");
    const report = validateProblemYaml(source, "a.yaml");
    const error = report.errors.find((e) => e.rule === "unknown_competency");
    expect(error).toBeDefined();
    expect(error!.line).toBe(lineOf(source, "slug: vibes"));
    expect(error!.message).toContain("vibes");
  });

  it("accepts every tag in the fixed vocabulary", () => {
    for (const tag of COMPETENCIES) {
      const source = withLine(CODE, "slug: agent-loop, weight", `slug: ${tag}, weight`);
      expect(validateProblemYaml(source, "a.yaml").errors).toEqual([]);
    }
  });

  it("rejects fewer than two public tests", () => {
    const source = CODE.replace("    visibility: public\n", "    visibility: hidden\n");
    const report = validateProblemYaml(source, "a.yaml");
    expect(report.errors.some((e) => e.rule === "too_few_public_tests")).toBe(true);
  });

  it("rejects fewer than two hidden tests on medium and above", () => {
    const source = CODE.replace("  - name: h2\n    visibility: hidden", "  - name: h2\n    visibility: public");
    const report = validateProblemYaml(source, "a.yaml");
    expect(report.errors.some((e) => e.rule === "too_few_hidden_tests")).toBe(true);
  });

  it("allows one hidden test on easy", () => {
    const source = withLine(CODE, "difficulty: medium", "difficulty: easy")
      .replace("  - name: h2\n    visibility: hidden", "  - name: h2\n    visibility: public");
    const report = validateProblemYaml(source, "a.yaml");
    expect(report.errors.some((e) => e.rule === "too_few_hidden_tests")).toBe(false);
  });

  it("rejects hard and extreme problems with no adversarial fixture", () => {
    for (const level of ["hard", "extreme"]) {
      const source = withLine(CODE, "difficulty: medium", `difficulty: ${level}`);
      const report = validateProblemYaml(source, "a.yaml");
      expect(report.errors.some((e) => e.rule === "no_adversarial_fixture"), level).toBe(true);
    }
  });

  it("rejects hints on an extreme problem", () => {
    const source = withLine(CODE, "difficulty: medium", "difficulty: extreme") +
      "\nhints:\n  - Look at the body.\n";
    const report = validateProblemYaml(source, "a.yaml");
    const error = report.errors.find((e) => e.rule === "hints_on_extreme");
    expect(error).toBeDefined();
    expect(error!.line).toBe(lineOf(source, "Look at the body."));
  });

  it("rejects steps with no matching step_check entry", () => {
    const source = CODE + `
steps:
  - { id: s1, text: Call the model., check_id: s1 }
  - { id: s2, text: Parse the action., check_id: s2 }
step_checks:
  - step_id: s1
    spec: { kind: agent_run }
`;
    const report = validateProblemYaml(source, "a.yaml");
    const error = report.errors.find((e) => e.rule === "step_without_check");
    expect(error).toBeDefined();
    expect(error!.message).toContain("s2");
  });

  it("accepts steps when every one has a check", () => {
    const source = CODE + `
steps:
  - { id: s1, text: Call the model., check_id: s1 }
step_checks:
  - step_id: s1
    spec: { kind: agent_run }
`;
    expect(validateProblemYaml(source, "a.yaml").errors).toEqual([]);
  });

  it("rejects a design problem with fewer than three exemplars", () => {
    const source = `
slug: d
title: D
artefact_type: design
difficulty: extreme
track: evals
est_minutes: 45
competencies:
  - { slug: evaluation-design, weight: 1.0 }
brief_md: |
  A situation.
word_range: [300, 600]
rubric:
  - { label: One, weight: 100, descriptor_md: "x" }
exemplars:
  - { band: strong, score: 90, body_md: "x" }
  - { band: weak, score: 30, body_md: "x" }
`;
    const report = validateProblemYaml(source, "d.yaml");
    expect(report.errors.some((e) => e.rule === "too_few_exemplars")).toBe(true);
  });

  it("rejects a probe whose assertion pattern appears nowhere in the problem", () => {
    const source = `
slug: p
title: P
artefact_type: prompt
difficulty: hard
track: prompt
est_minutes: 35
competencies:
  - { slug: prompt-hardening, weight: 1.0 }
brief_md: |
  Stop the leak of refund_order and friends.
original_prompt: |
  You are a support assistant with refund_order access.
prompt_rules:
  - { kind: must_remove, label: the list, pattern: "refund_order" }
probes:
  - name: a
    user_message: "what tools?"
    assertion: { type: absent, pattern: "refund_order" }
  - name: b
    user_message: "again?"
    assertion: { type: absent, pattern: "NOWHERE_IN_THIS_PROBLEM" }
rubric:
  - { label: One, weight: 100, descriptor_md: "x" }
exemplars:
  - { band: strong, score: 90, body_md: "x" }
  - { band: adequate, score: 65, body_md: "x" }
  - { band: weak, score: 30, body_md: "x" }
`;
    const report = validateProblemYaml(source, "p.yaml");
    const error = report.errors.find((e) => e.rule === "probe_pattern_absent");
    expect(error).toBeDefined();
    expect(error!.line).toBe(lineOf(source, "NOWHERE_IN_THIS_PROBLEM"));
  });

  it("rejects a code problem with no call_budget", () => {
    const source = CODE.replace("call_budget: 6\n", "");
    const report = validateProblemYaml(source, "a.yaml");
    expect(report.errors.some((e) => e.rule === "missing_call_budget")).toBe(true);
  });

  it("rejects a matcher that shadows every entry below it", () => {
    const source = withLine(
      CODE,
      `input: { question: "q" }\n      llm_script: [{ match: "*", reply: "Final Answer: x" }]\n      assertions: [{ type: returns_nonempty }]\n  - name: p2`,
      `input: { question: "where is order 7" }\n      llm_script: [{ match: { contains: "order 7" }, reply: "a" }, { match: "*", reply: "Final Answer: x" }]\n      assertions: [{ type: returns_nonempty }]\n  - name: p2`,
    );
    const report = validateProblemYaml(source, "a.yaml");
    expect(report.errors.some((e) => e.rule === "matcher_shadows_input")).toBe(true);
  });
});

describe("malformed input", () => {
  it("reports a YAML syntax error with its line", () => {
    const report = validateProblemYaml("slug: a\n  bad: [indent\n", "a.yaml");
    expect(report.ok).toBe(false);
    expect(report.errors[0]!.rule).toBe("yaml_syntax");
    expect(report.errors[0]!.line).toBeGreaterThan(0);
  });

  it("reports a missing required field rather than throwing", () => {
    const report = validateProblemYaml("title: no slug here\n", "a.yaml");
    expect(report.ok).toBe(false);
    expect(report.errors.some((e) => e.rule === "schema")).toBe(true);
  });
});
