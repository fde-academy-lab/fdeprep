/**
 * The evaluation panel, from docs/10 section 14.
 *
 * Written before the implementation, so these test the behaviour the spec
 * requires rather than the code that happens to exist.
 *
 * The panelists here are fakes. That is deliberate: the panel's job is
 * ordering, degradation and consolidation, and a test that needed a real
 * Bedrock call to prove the outage path would never run in CI, which is
 * exactly when the outage path matters.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../lib/db/pool.ts";
import {
  runPanel, type Panelist, type PanelistResult, type PanelInput,
} from "../lib/eval/panel.ts";
import {
  learnerFacing, saveEvaluation, latestEvaluation, reevaluationBacklog,
} from "../lib/eval/record.ts";
import { createSubmission } from "../lib/submissions/create.ts";
import { validateProblemYaml } from "../lib/problems/validate.ts";
import { panelFor, defaultComplexity, type Complexity } from "../lib/policy/complexity.ts";
import { importFixtures, resetDatabase, seedLearner } from "./helpers.ts";

afterAll(async () => {
  await closeDb();
});

beforeEach(async () => {
  await resetDatabase();
});

/** A panelist that records whether it was asked to run at all. */
function fake(
  name: "static" | "pretrained" | "llm",
  result: Partial<PanelistResult> = {},
): Panelist & { calls: number } {
  const p = {
    name,
    calls: 0,
    async run(_input: PanelInput): Promise<PanelistResult> {
      p.calls += 1;
      return { status: "ran", ms: 1, findings: [], ...result } as PanelistResult;
    },
  };
  return p;
}

function unavailable(name: "pretrained" | "llm", reason: string): Panelist & { calls: number } {
  const p = {
    name,
    calls: 0,
    async run(): Promise<PanelistResult> {
      p.calls += 1;
      return { status: "unavailable", reason, ms: 0, findings: [] };
    },
  };
  return p;
}

/** A panelist this deployment does not have, as against one that broke. */
function skipped(name: "pretrained" | "llm", reason: string): Panelist {
  return {
    name,
    async run(): Promise<PanelistResult> {
      return { status: "skipped", reason, ms: 0, findings: [] };
    },
  };
}

const INPUT: Omit<PanelInput, "complexity"> = {
  submissionId: 1,
  artefactType: "design",
  body: "An answer.",
  problemSlug: "a-problem",
};

function input(complexity: Complexity): PanelInput {
  return { ...INPUT, complexity };
}

describe("which panelists a complexity level demands", () => {
  it("runs P1 alone on C1, and asks no model anything", async () => {
    const p1 = fake("static", { verdict: "pass", scoreContribution: 100 });
    const p2 = fake("pretrained");
    const p3 = fake("llm");

    const started = Date.now();
    const evaluation = await runPanel(input("C1"), [p1, p2, p3]);

    expect(p1.calls).toBe(1);
    expect(p2.calls).toBe(0);
    expect(p3.calls).toBe(0);
    expect(evaluation.state).toBe("complete");
    // docs/10 section 14 criterion 1. The budget is generous because CI
    // machines are slow; the point is that nothing here waits on a network.
    expect(Date.now() - started).toBeLessThan(100);
  });

  it("refuses to spend a model call on an exact-match question", () => {
    expect(panelFor("C1").llm).toBe("no");
    expect(panelFor("C4").llm).toBe("required");
    expect(panelFor("C5").llm).toBe("required");
  });

  it("always demands P1, at every level", () => {
    for (const level of ["C1", "C2", "C3", "C4", "C5"] as Complexity[]) {
      expect(panelFor(level).static).toBe("required");
    }
  });

  it("gives today's content a complexity without a backfill", () => {
    // Nothing in problems/ carries `complexity` yet. A default derived from the
    // artefact type is what lets the panel run at all before that lands.
    expect(defaultComplexity("code")).toBe("C2");
    expect(defaultComplexity("design")).toBe("C4");
  });
});

describe("P1 runs first, and it is the only panelist that can fail a submission", () => {
  it("puts the static panelist first whatever order it was handed", async () => {
    const order: string[] = [];
    const record = (name: "static" | "pretrained" | "llm"): Panelist => ({
      name,
      async run() {
        order.push(name);
        return { status: "ran", ms: 1, findings: [] };
      },
    });

    await runPanel(input("C4"), [record("llm"), record("pretrained"), record("static")]);

    expect(order[0]).toBe("static");
  });

  it("fails when the deterministic gate failed", async () => {
    const evaluation = await runPanel(input("C4"), [
      fake("static", { verdict: "fail", scoreContribution: 40 }),
      fake("pretrained", { band: "strong" }),
      fake("llm", { band: "strong" }),
    ]);

    expect(evaluation.verdict).toBe("fail");
  });

  it("does not let a band overturn a deterministic pass, or create a fail", async () => {
    // A model's opinion is not a fact. docs/10 section 7.
    const evaluation = await runPanel(input("C4"), [
      fake("static", { verdict: "pass", scoreContribution: 100 }),
      fake("pretrained", { band: "weak" }),
      fake("llm", { band: "off_question" }),
    ]);

    expect(evaluation.verdict).toBe("pass");
  });
});

describe("degradation, which is the point of the panel", () => {
  it("returns a partial evaluation carrying what did run", async () => {
    const evaluation = await runPanel(input("C4"), [
      fake("static", { verdict: "pass", scoreContribution: 70,
                       findings: [{ code: "headings_present", detail: "3 of 3",
                                    severity: "informational" }] }),
      fake("pretrained", { band: "adequate" }),
      unavailable("llm", "deadline_exceeded"),
    ]);

    expect(evaluation.state).toBe("partial");
    expect(evaluation.scoreProvisional).toBe(true);
    expect(evaluation.confidence).not.toBe("high");
    const ran = evaluation.panel.filter((p) => p.status === "ran").map((p) => p.panelist);
    expect(ran).toEqual(["static", "pretrained"]);
    expect(evaluation.panel.find((p) => p.panelist === "llm")?.reason)
      .toBe("deadline_exceeded");
  });

  it("says the panel was thin when a level's required panelist was skipped", async () => {
    // Skipped, not unavailable: this deployment does not have the panelist,
    // so no re-run is owed and the evaluation is complete. What it must not
    // claim is the confidence of a full panel. The record is what an appeal
    // and a placement conversation both read.
    const evaluation = await runPanel(input("C4"), [
      fake("static", { verdict: "pass", scoreContribution: 70 }),
      skipped("pretrained", "model_missing"),
      fake("llm", { band: "strong" }),
    ]);

    expect(evaluation.state).toBe("complete");
    expect(evaluation.scoreProvisional).toBe(false);
    expect(evaluation.confidence).toBe("medium");
    // No free re-run is promised, because none is coming.
    expect(evaluation.feedbackMd).not.toContain("still running");
  });

  it("keeps full confidence when the skipped panelist was only optional", async () => {
    // A code problem is C2. Panelist 2 adds nothing its tests did not already
    // say, so its absence costs the evaluation nothing at all.
    const evaluation = await runPanel(input("C2"), [
      fake("static", { verdict: "pass", scoreContribution: 100 }),
      skipped("pretrained", "no_graded_pool"),
      fake("llm", { band: "strong" }),
    ]);

    expect(evaluation.confidence).toBe("high");
  });

  it("still answers when only P1 survives", async () => {
    const evaluation = await runPanel(input("C4"), [
      fake("static", { verdict: "fail", scoreContribution: 30 }),
      unavailable("pretrained", "model_load_failed"),
      unavailable("llm", "bedrock_unreachable"),
    ]);

    expect(evaluation.state).toBe("partial");
    expect(evaluation.verdict).toBe("fail");
    // A learner mid-incident gets thinner feedback and never gets silence.
    expect(evaluation.feedbackMd.length).toBeGreaterThan(0);
  });

  it("errors, and consumes nothing, when P1 itself cannot run", async () => {
    const evaluation = await runPanel(input("C4"), [
      unavailable("static" as "pretrained", "runner_crashed"),
      fake("pretrained", { band: "strong" }),
      fake("llm", { band: "strong" }),
    ]);

    expect(evaluation.state).toBe("error");
    expect(evaluation.verdict).toBeNull();
    expect(evaluation.score).toBeNull();
  });

  it("never lowers a score because a panelist was down", async () => {
    const whole = await runPanel(input("C4"), [
      fake("static", { verdict: "pass", scoreContribution: 60 }),
      fake("pretrained", { band: "strong" }),
      fake("llm", { band: "strong" }),
    ]);
    const degraded = await runPanel(input("C4"), [
      fake("static", { verdict: "pass", scoreContribution: 60 }),
      fake("pretrained", { band: "strong" }),
      unavailable("llm", "bedrock_unreachable"),
    ]);

    expect(degraded.score).toBeLessThanOrEqual(whole.score!);
    expect(degraded.scoreProvisional).toBe(true);
  });
});

describe("a re-evaluation finishes the work the platform already owed", () => {
  /** A real submission row, because the record carries a foreign key to one. */
  async function seedSubmission(): Promise<{ id: number; enrolmentId: number }> {
    await importFixtures();
    const learner = await seedLearner();
    const { rows } = await db().query<{ id: string }>(
      "select id from problem where slug = 'echo-the-question'");
    const submission = await createSubmission({
      enrolmentId: learner.enrolmentId, cohortId: learner.cohortId,
      problemId: Number(rows[0]!.id), kind: "run",
      body: "def run_agent(q, llm, tools): return q",
    });
    return { id: submission.id, enrolmentId: learner.enrolmentId };
  }

  it("completes a partial record and never moves a learner's score down", async () => {
    const { id, enrolmentId } = await seedSubmission();
    const at = (c: Complexity): PanelInput => ({ ...input(c), submissionId: id });

    const first = await runPanel(at("C4"), [
      fake("static", { verdict: "pass", scoreContribution: 60 }),
      fake("pretrained", { band: "adequate" }),
      unavailable("llm", "bedrock_unreachable"),
    ]);
    await saveEvaluation(first, enrolmentId);
    expect(first.state).toBe("partial");

    const second = await runPanel(at("C4"), [
      fake("static", { verdict: "pass", scoreContribution: 60 }),
      fake("pretrained", { band: "adequate" }),
      fake("llm", { band: "strong" }),
    ]);
    await saveEvaluation(second, enrolmentId);

    const latest = await latestEvaluation(id);
    expect(latest!.state).toBe("complete");
    expect(latest!.scoreProvisional).toBe(false);
    expect(latest!.score).toBeGreaterThanOrEqual(first.score!);

    // Immutable: the partial row is still there, which is what makes an
    // outage auditable after the fact.
    const { rows } = await db().query<{ n: string }>(
      "select count(*) as n from evaluation where submission_id = $1", [id]);
    expect(Number(rows[0]!.n)).toBe(2);
  });

  it("floors a completed re-evaluation at the provisional score it replaces", async () => {
    // The outage gave this learner 65. The full panel would give 35. They keep
    // the 65: the platform owed them the review and does not get to charge
    // them for having been slow to deliver it.
    const { id, enrolmentId } = await seedSubmission();
    const at = (c: Complexity): PanelInput => ({ ...input(c), submissionId: id });

    const partial = await runPanel(at("C4"), [
      fake("static", { verdict: "pass", scoreContribution: 60 }),
      fake("pretrained", { band: "adequate" }),
      unavailable("llm", "bedrock_unreachable"),
    ]);
    await saveEvaluation(partial, enrolmentId);

    const complete = await runPanel(at("C4"), [
      fake("static", { verdict: "pass", scoreContribution: 60 }),
      fake("pretrained", { band: "weak" }),
      fake("llm", { band: "weak" }),
    ]);
    await saveEvaluation(complete, enrolmentId);

    expect(complete.score).toBeLessThan(partial.score!);
    expect((await latestEvaluation(id))!.score).toBe(partial.score);
  });

  it("lists a partial as backlog and stops listing it once completed", async () => {
    const { id, enrolmentId } = await seedSubmission();
    const at = (c: Complexity): PanelInput => ({ ...input(c), submissionId: id });

    await saveEvaluation(await runPanel(at("C4"), [
      fake("static", { verdict: "pass", scoreContribution: 60 }),
      fake("pretrained", { band: "adequate" }),
      unavailable("llm", "bedrock_unreachable"),
    ]), enrolmentId);
    expect(await reevaluationBacklog()).toContain(id);

    await saveEvaluation(await runPanel(at("C4"), [
      fake("static", { verdict: "pass", scoreContribution: 60 }),
      fake("pretrained", { band: "adequate" }),
      fake("llm", { band: "adequate" }),
    ]), enrolmentId);
    expect(await reevaluationBacklog()).not.toContain(id);
  });
});

describe("disagreement is reported, never averaged", () => {
  it("flags two bands apart, holds the lower, and does not take the mean", async () => {
    const evaluation = await runPanel(input("C5"), [
      fake("static", { verdict: "pass", scoreContribution: 50 }),
      fake("pretrained", { band: "weak" }),
      fake("llm", { band: "strong" }),
    ]);

    expect(evaluation.disagreement).not.toBeNull();
    expect(evaluation.disagreement!.held).toBe("weak");
    expect(evaluation.disagreement!.bands.sort()).toEqual(["strong", "weak"]);
    expect(evaluation.confidence).toBe("low");
  });

  it("stays quiet when they agree, and says so in the confidence", async () => {
    const evaluation = await runPanel(input("C5"), [
      fake("static", { verdict: "pass", scoreContribution: 50 }),
      fake("pretrained", { band: "adequate" }),
      fake("llm", { band: "adequate" }),
    ]);

    expect(evaluation.disagreement).toBeNull();
    expect(evaluation.confidence).toBe("high");
  });

  it("does not flag one band apart, which is normal judging", async () => {
    const evaluation = await runPanel(input("C5"), [
      fake("static", { verdict: "pass", scoreContribution: 50 }),
      fake("pretrained", { band: "adequate" }),
      fake("llm", { band: "strong" }),
    ]);

    expect(evaluation.disagreement).toBeNull();
  });
});

describe("the learner hears one voice", () => {
  it("carries no panelist name into anything the learner reads", async () => {
    const evaluation = await runPanel(input("C4"), [
      fake("static", { verdict: "fail", scoreContribution: 55,
                       findings: [{ code: "hidden_gate_failed", detail: "5 of 7",
                                    severity: "blocking" }] }),
      fake("pretrained", { band: "weak" }),
      unavailable("llm", "deadline_exceeded"),
    ]);

    const payload = JSON.stringify(learnerFacing(evaluation));
    for (const leak of ["static", "pretrained", "llm", "panelist", "bedrock",
                        "deadline_exceeded"]) {
      expect(payload.toLowerCase()).not.toContain(leak);
    }
    // It still has to say something useful, and name the next action.
    expect(learnerFacing(evaluation).feedback_md.length).toBeGreaterThan(20);
  });

  it("keeps provenance for faculty on the record itself", async () => {
    const evaluation = await runPanel(input("C4"), [
      fake("static", { verdict: "fail", scoreContribution: 55 }),
      fake("pretrained", { band: "weak" }),
      unavailable("llm", "deadline_exceeded"),
    ]);

    expect(evaluation.panel.map((p) => p.panelist))
      .toEqual(["static", "pretrained", "llm"]);
  });
});

describe("the validator refuses a panel that could not degrade", () => {
  // The smallest code problem that already validates, so each case below
  // changes exactly one thing and the rule under test is the only variable.
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
`;

  const check = (extra: string) => validateProblemYaml(BASE + extra, "a-problem.yaml");

  it("accepts today's problems, which declare neither field", () => {
    expect(check("").ok).toBe(true);
  });

  it("rejects a panel that names a model panelist and no static one", () => {
    // docs/10 section 14 criterion 6.
    const report = check("complexity: C4\npanel: { pretrained: true, llm: true }\n");
    expect(report.ok).toBe(false);
    const error = report.errors.find((e) => e.rule === "panel_without_static");
    expect(error).toBeDefined();
    expect(error!.file).toBe("a-problem.yaml");
    // Naming the line is the difference between a fix and a hunt.
    expect(error!.line).toBeGreaterThan(1);
  });

  it("rejects a level that demands a panelist the panel does not declare", () => {
    const report = check("complexity: C4\npanel: { static: true, pretrained: true }\n");
    expect(report.ok).toBe(false);
    expect(report.errors.some((e) => e.rule === "panel_mismatch")).toBe(true);
  });

  it("rejects a model call on an exact-match question", () => {
    const report = check("complexity: C1\npanel: { static: true, llm: true }\n");
    expect(report.ok).toBe(false);
    expect(report.errors.some((e) => e.rule === "panel_mismatch")).toBe(true);
  });

  it("rejects a complexity outside C1 to C5", () => {
    const report = check("complexity: epic\n");
    expect(report.ok).toBe(false);
    expect(report.errors.some((e) => e.rule === "bad_complexity")).toBe(true);
  });

  it("accepts a coherent declaration", () => {
    expect(check("complexity: C3\npanel: { static: true, pretrained: true }\n").ok).toBe(true);
  });
});
