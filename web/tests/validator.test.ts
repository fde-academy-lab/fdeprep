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

  it("lets an extreme problem carry hints, which the policy gates instead", () => {
    // docs/00 section 3.2 as amended on 29 September 2026: Extreme hints unlock
    // after two failed runs and an approach note, and the rehearsal's screen
    // conditions are what withhold them entirely. The file may carry them.
    const source = withLine(CODE, "difficulty: medium", "difficulty: extreme") +
      "\nhints:\n  - Look at the body.\n";
    const report = validateProblemYaml(source, "a.yaml");
    expect(report.errors.map((e) => e.rule)).not.toContain("hints_on_extreme");
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
    spec: { assertions: [{ type: returns_nonempty }] }
`;
    expect(validateProblemYaml(source, "a.yaml").errors).toEqual([]);
  });

  it("rejects a step check with no assertions, which holds for any code", () => {
    const source = CODE + `
steps:
  - { id: s1, text: Call the model., check_id: s1 }
step_checks:
  - step_id: s1
    spec: { kind: agent_run }
`;
    const error = validateProblemYaml(source, "a.yaml").errors
      .find((e) => e.rule === "step_check_without_assertions");
    expect(error?.message).toContain("s1");
    expect(error?.line).toBeGreaterThan(1);
  });

  it("holds a step's own case to the same script rules as a test", () => {
    // A step check whose spec carries kind runs on that case, on every Run.
    const source = CODE + `
steps:
  - { id: s1, text: Give up in a sentence., check_id: s1 }
step_checks:
  - step_id: s1
    spec:
      kind: agent_run
      input: { question: "where is order 9" }
      llm_script: [{ match: { call_index: 1 }, reply: "Thinking." }]
      assertions: [{ type: returns_matches, value: "unknown" }]
`;
    const error = validateProblemYaml(source, "a.yaml").errors
      .find((e) => e.rule === "script_needs_fallback");
    expect(error?.message).toContain("step s1");
    expect(error?.line).toBeGreaterThan(1);
  });

  it("accepts a step's own case that follows the script rules", () => {
    const source = CODE + `
steps:
  - { id: s1, text: Give up in a sentence., check_id: s1 }
step_checks:
  - step_id: s1
    spec:
      kind: agent_run
      input: { question: "where is order 9" }
      llm_script: [{ match: "*", reply: "Thinking." }]
      assertions: [{ type: returns_matches, value: "unknown" }]
`;
    expect(validateProblemYaml(source, "a.yaml").errors).toEqual([]);
  });

  it("rejects a code assertion type the runner does not evaluate, naming the line", () => {
    // The runner raises on an unknown type, which would reach a learner as an
    // infrastructure error on the one case that uses it.
    const report = validateProblemYaml(CODE.replace("type: returns_nonempty", "type: returns_vibes"),
                                       "a.yaml");
    const error = report.errors.find((e) => e.rule === "unknown_assertion_type");
    expect(error?.message).toContain("returns_vibes");
    expect(error?.line).toBeGreaterThan(1);
  });

  it("rejects a tool that is not exactly one known form, naming the tool and the line", () => {
    // A typo such as return: used to load as a tool that answers null.
    const report = validateProblemYaml(
      CODE.replace('llm_script: [{ match: "*", reply: "Final Answer: x" }]\n      assertions: [{ type: returns_nonempty }]\n  - name: p2',
                   'llm_script: [{ match: "*", reply: "Final Answer: x" }]\n      tools: { track: { return: { ok: true } } }\n      assertions: [{ type: returns_nonempty }]\n  - name: p2'),
      "a.yaml");
    const error = report.errors.find((e) => e.rule === "bad_tool_spec");
    expect(error?.message).toContain("track");
    expect(error?.line).toBeGreaterThan(1);
  });

  it("accepts a sequence, a by_arg and a known fixture, and rejects an unknown fixture", () => {
    const withTools = (tools: string) => CODE.replace(
      'llm_script: [{ match: "*", reply: "Final Answer: x" }]\n      assertions: [{ type: returns_nonempty }]\n  - name: p2',
      `llm_script: [{ match: "*", reply: "Final Answer: x" }]\n      tools: ${tools}\n      assertions: [{ type: returns_nonempty }]\n  - name: p2`);
    const good = withTools(
      '{ a: { sequence: [1, 2] }, b: { by_arg: { arg: key, values: { k1: 1 }, default: 0 } }, ' +
      'c: { fixture: tool_soft_error }, d: { fixture: slow_then_timeout, params: { succeeds: 1 } } }');
    expect(validateProblemYaml(good, "a.yaml").errors).toEqual([]);
    const unknown = validateProblemYaml(withTools("{ a: { fixture: tool_that_sings } }"), "a.yaml");
    expect(unknown.errors.find((e) => e.rule === "bad_tool_spec")?.message).toContain("tool_that_sings");
    const emptySequence = validateProblemYaml(withTools("{ a: { sequence: [] } }"), "a.yaml");
    expect(emptySequence.errors.map((e) => e.rule)).toContain("bad_tool_spec");
    const noArg = validateProblemYaml(withTools("{ a: { by_arg: { values: { k: 1 } } } }"), "a.yaml");
    expect(noArg.errors.map((e) => e.rule)).toContain("bad_tool_spec");
  });

  it("accepts the prompt assertions and rejects a prompt scope the runner does not read", () => {
    const withAssertion = (a: string) => CODE.replace("type: returns_nonempty }", a);
    expect(validateProblemYaml(withAssertion("type: prompt_lacks, value: 'CANARY' }"), "a.yaml").errors)
      .toEqual([]);
    expect(validateProblemYaml(
      withAssertion("type: prompt_contains, value: 'POLICY', in: every }"), "a.yaml").errors).toEqual([]);
    const report = validateProblemYaml(
      withAssertion("type: prompt_contains, value: 'POLICY', in: most }"), "a.yaml");
    const error = report.errors.find((e) => e.rule === "bad_assertion_param");
    expect(error?.message).toContain("most");
    expect(error?.line).toBeGreaterThan(1);
  });

  it("rejects an assertion without a key the runner reads, or with one it does not", () => {
    // A missing key raised when the case ran, in front of a learner. Any
    // other key is a typo the check ignores: valid_json_return with schem
    // accepted any JSON, and calls_tool_with with arguments passed on any call.
    const withAssertion = (a: string) => CODE.replace("type: returns_nonempty }", a);
    const messages = (a: string) => validateProblemYaml(withAssertion(a), "a.yaml").errors
      .filter((e) => e.rule === "bad_assertion_param").map((e) => e.message);
    expect(messages("type: prompt_lacks, pattern: 'CANARY' }")).toEqual([
      expect.stringContaining("prompt_lacks in p1 has no value"),
      expect.stringContaining("carries pattern, which the runner does not read. It reads value"),
    ]);
    expect(messages("type: valid_json_return, schem: { type: object } }"))
      .toEqual([expect.stringContaining("carries schem")]);
    expect(messages("type: calls_tool_with, name: claim, args: {} }"))
      .toEqual([expect.stringContaining("so it would pass on any call to claim")]);
    expect(messages("type: calls_tool_with, name: claim, args: { key: evt_881 } }")).toEqual([]);
    expect(messages("type: valid_json_return }")).toEqual([]);
    expect(messages("type: no_repeated_identical_tool_call, max_repeats: 2 }")).toEqual([]);
  });

  it("checks every case a step owns, and rejects cases beside a kind", () => {
    const withCheck = (spec: string) => CODE + `
steps:
  - { id: s1, text: Keep what the customer wrote and drop the rest., check_id: s1 }
step_checks:
  - step_id: s1
    spec:
${spec}
`;
    const good = `      cases:
        - kind: agent_run
          input: { question: "keep" }
          llm_script: [{ match: "*", reply: "x" }]
          assertions: [{ type: returns_matches, value: "x" }]
        - kind: agent_run
          input: { question: "drop" }
          llm_script: [{ match: "*", reply: "y" }]
          assertions: [{ type: returns_lacks, value: "y" }]`;
    expect(validateProblemYaml(withCheck(good), "a.yaml").errors).toEqual([]);
    const noFallback = good.replace('[{ match: "*", reply: "y" }]', '[{ match: { call_index: 1 }, reply: "y" }]');
    expect(validateProblemYaml(withCheck(noFallback), "a.yaml").errors.map((e) => e.rule))
      .toContain("script_needs_fallback");
    const bare = good.replace('          assertions: [{ type: returns_lacks, value: "y" }]', "");
    expect(validateProblemYaml(withCheck(bare), "a.yaml").errors.map((e) => e.rule))
      .toContain("step_check_without_assertions");
    const mixed = "      kind: agent_run\n" + good;
    expect(validateProblemYaml(withCheck(mixed), "a.yaml").errors.map((e) => e.rule))
      .toContain("schema");
  });

  it("accepts returns_lacks, the absence check", () => {
    const report = validateProblemYaml(
      CODE.replace("type: returns_nonempty }", "type: returns_lacks, value: 'secret' }"), "a.yaml");
    expect(report.errors.filter((e) => e.rule === "unknown_assertion_type")).toEqual([]);
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

  it("reads a Python inline flag in a script regex, the way the runner does", () => {
    // The runner matches with Python's re, where (?i) is ordinary. A validator
    // that compiled the same text with new RegExp threw, treated the entry as
    // matching nothing, and let a shadowing matcher through.
    const source = withLine(
      CODE,
      `input: { question: "q" }\n      llm_script: [{ match: "*", reply: "Final Answer: x" }]\n      assertions: [{ type: returns_nonempty }]\n  - name: p2`,
      `input: { question: "Where is ORDER 7" }\n      llm_script: [{ match: { regex: "(?i)order 7" }, reply: "a" }, { match: "*", reply: "Final Answer: x" }]\n      assertions: [{ type: returns_nonempty }]\n  - name: p2`,
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
