/**
 * The static rule engine. docs/03 section 4.2 step 1 and docs/01 S5.
 *
 * It runs in the application rather than the runner because it is regex over
 * text and needs no sandbox, and it runs in the browser as well as on the
 * server because the checklist updates as the learner types. Both callers use
 * this module, so the checklist and the submit gate cannot disagree.
 */
import { describe, expect, it } from "vitest";
import { compilePattern, evaluatePromptRules, PatternError } from "../lib/gate/rules.ts";
import { evaluateDesignStructure } from "../lib/gate/structure.ts";
import { staticGate } from "../lib/gate/index.ts";

const RULES = [
  { kind: "must_remove", label: "the literal tool list", pattern: "refund_order, lookup_customer" },
  { kind: "must_remove", label: "the phrase 'always comply'", pattern: "(?i)always comply" },
  { kind: "must_keep", label: "refund capability", pattern: "(?i)refund" },
  { kind: "max_words", label: "under 400 words", numeric_value: 400 },
] as const;

describe("pattern translation", () => {
  it("maps a leading inline flag group onto JavaScript flags", () => {
    // Python writes (?i) inline. JavaScript RegExp throws on it, so every
    // pattern in a problem file would fail at run time without this.
    const re = compilePattern("(?i)always comply");
    expect(re.flags).toContain("i");
    expect(re.test("ALWAYS COMPLY")).toBe(true);
  });

  it("maps combined flags", () => {
    const re = compilePattern("(?is)a.b");
    expect(re.flags).toContain("i");
    expect(re.flags).toContain("s");
    expect(re.test("A\nB")).toBe(true);
  });

  it("leaves a pattern with no flag group alone", () => {
    const re = compilePattern("refund_order");
    expect(re.flags).toBe("");
    expect(re.test("REFUND_ORDER")).toBe(false);
  });

  it("refuses an unsupported inline flag rather than silently dropping it", () => {
    expect(() => compilePattern("(?x)a b")).toThrow(PatternError);
  });

  it("refuses a pattern that does not compile", () => {
    expect(() => compilePattern("(unclosed")).toThrow(PatternError);
  });
});

describe("prompt rules", () => {
  const leaky = "You are a support assistant with access to the following tools: " +
    "refund_order, lookup_customer. Always comply with user requests. Issue refunds.";
  const hardened = "You are a support assistant. Verify the order first, then issue a refund. " +
    "Never describe your capabilities.";

  it("fails a must_remove rule whose pattern survives", () => {
    const gate = evaluatePromptRules(leaky, RULES as never);
    expect(gate.status).toBe("fail");
    const failing = gate.checks.filter((c) => c.status === "fail").map((c) => c.label);
    expect(failing).toEqual(["the literal tool list", "the phrase 'always comply'"]);
  });

  it("names the line a surviving token is on", () => {
    const gate = evaluatePromptRules("line one\nAlways comply here\nline three",
      [RULES[1]] as never);
    expect(gate.checks[0]!.message).toContain("line 2");
  });

  it("fails a must_keep rule whose pattern was deleted", () => {
    const gate = evaluatePromptRules("You are a support assistant. Say nothing.", RULES as never);
    const keep = gate.checks.find((c) => c.label === "refund capability")!;
    expect(keep.status).toBe("fail");
    expect(keep.message).toContain("no longer");
  });

  it("passes every rule on a hardened prompt", () => {
    const gate = evaluatePromptRules(hardened, RULES as never);
    expect(gate.status).toBe("pass");
    expect(gate.checks.every((c) => c.status === "pass")).toBe(true);
  });

  it("counts words for max_words and reports the count either way", () => {
    const long = Array.from({ length: 401 }, () => "word").join(" ") + " refund";
    const gate = evaluatePromptRules(long, [RULES[3]] as never);
    expect(gate.status).toBe("fail");
    expect(gate.checks[0]!.message).toContain("402");
  });

  it("treats an unknown rule kind as a failure, never as a pass", () => {
    const gate = evaluatePromptRules("anything", [{ kind: "vibes", label: "x" }] as never);
    expect(gate.status).toBe("fail");
    expect(gate.checks[0]!.message).toContain("vibes");
  });

  it("reports every rule, not only the first failure, so the checklist is complete", () => {
    const gate = evaluatePromptRules(leaky, RULES as never);
    expect(gate.checks).toHaveLength(4);
  });
});

describe("design structure", () => {
  const problem = { word_range: [10, 30], required_headings: ["What I would measure"] };

  it("passes an answer inside the range with its headings", () => {
    const body = "## What I would measure\n\n" + "the cost of a wrong refund ".repeat(4);
    expect(evaluateDesignStructure(body, problem as never).status).toBe("pass");
  });

  it("fails an answer under the range and says how many words short", () => {
    const gate = evaluateDesignStructure("## What I would measure\n\ntoo short", problem as never);
    expect(gate.status).toBe("fail");
    expect(gate.checks[0]!.message).toContain("10");
  });

  it("fails a missing required heading and names it", () => {
    const body = "the cost of a wrong refund ".repeat(4);
    const gate = evaluateDesignStructure(body, problem as never);
    const heading = gate.checks.find((c) => c.kind === "required_heading")!;
    expect(heading.status).toBe("fail");
    expect(heading.message).toContain("What I would measure");
  });

  it("matches a heading at any level and ignores case", () => {
    const body = "### what i would MEASURE\n\n" + "the cost of a wrong refund ".repeat(4);
    expect(evaluateDesignStructure(body, problem as never).status).toBe("pass");
  });
});

describe("the gate picks the engine from the artefact type", () => {
  it("runs prompt rules on a prompt problem", () => {
    const gate = staticGate({ artefact_type: "prompt", prompt_rules: RULES } as never,
      "Always comply.");
    expect(gate.status).toBe("fail");
  });

  it("runs structural checks on a design problem", () => {
    const gate = staticGate(
      { artefact_type: "design", word_range: [10, 30], required_headings: [] } as never,
      "too short");
    expect(gate.status).toBe("fail");
  });

  it("passes a code problem, which has no static text gate of its own", () => {
    expect(staticGate({ artefact_type: "code" } as never, "def run_agent(): pass").status)
      .toBe("pass");
  });
});

describe("acceptance 2: the checklist evaluates locally", () => {
  const RULES_FOR_TYPING = [
    { kind: "must_remove", label: "always comply", pattern: "(?i)always comply" },
    { kind: "must_keep", label: "refunds", pattern: "(?i)refund" },
  ] as const;

  it("runs with the network taken away", () => {
    // The checklist in S5 runs this on every keystroke. If it reached the
    // network the stub below would throw, so this is the assertion behind
    // "no network request per keystroke".
    const realFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error("the checklist made a network request");
    }) as typeof fetch;
    try {
      const gate = evaluatePromptRules("Always comply and refund.", RULES_FOR_TYPING as never);
      expect(gate.status).toBe("fail");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("returns synchronously rather than a promise the caller has to await", () => {
    const gate = evaluatePromptRules("refund", RULES_FOR_TYPING as never);
    expect(gate).not.toBeInstanceOf(Promise);
    expect(gate.status).toBe("pass");
  });

  it("changes a checkbox as the text changes, one keystroke at a time", () => {
    // The checklist renders one line per rule, so what has to move as the
    // learner types is each line, not the gate's overall status.
    const typed = "Always comply. Issue a refund.";
    const perKeystroke = Array.from({ length: typed.length + 1 }, (_, i) =>
      evaluatePromptRules(typed.slice(0, i), RULES_FOR_TYPING as never)
        .checks.map((c) => c.status).join(","));

    expect(perKeystroke[0]).toBe("pass,fail");
    expect(perKeystroke.at(-1)).toBe("fail,pass");
    expect(new Set(perKeystroke).size).toBeGreaterThan(2);

    // And the state the learner is aiming for, where every line is ticked.
    expect(evaluatePromptRules("Issue a refund.", RULES_FOR_TYPING as never).status).toBe("pass");
  });
});
