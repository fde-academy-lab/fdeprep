/**
 * The startup contract. docs/10 section 9.
 *
 * A worker that cannot run a panelist its own catalogue requires should say so
 * at boot, not discover it one submission at a time. These tests were written
 * before the implementation, so they describe what a worker owes an operator
 * rather than what the code happens to do.
 *
 * The probe is injected. A test that needed the real 46MB model to prove the
 * refusal path would skip in CI, which is exactly where the refusal matters.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../lib/db/pool.ts";
import { preflight, type Probe } from "../lib/eval/preflight.ts";
import { publishImport } from "../lib/problems/import.ts";
import { validateProblemYaml } from "../lib/problems/validate.ts";
import { FIXTURES, resetDatabase } from "./helpers.ts";

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closeDb();
});

/** Publish one fixture, so a test can build a catalogue of a chosen shape. */
async function publish(file: string, options: { publish?: boolean } = {}): Promise<void> {
  const source = await readFile(path.join(FIXTURES, file), "utf8");
  const report = validateProblemYaml(source, file);
  if (!report.problem) throw new Error(`${file} does not validate`);
  await publishImport(report.problem, source, { publish: options.publish ?? true });
}

/** A probe that counts how often it was asked. */
function counting(result: { ok: true } | { ok: false; reason: string }) {
  const state = { calls: 0 };
  const probe: Probe = async () => { state.calls += 1; return result; };
  return { probe, state };
}

describe("the catalogue decides what the worker must be able to do", () => {
  it("lets a code-only catalogue start without the embedding model", async () => {
    // A code problem is C2, where panelist 2 is optional: it is graded by its
    // tests and the band adds nothing the verdict did not already say. A box
    // that only serves code has no reason to carry 46MB of weights.
    await publish("echo-the-question.yaml");
    const { probe } = counting({ ok: false, reason: "model_missing" });

    const report = await preflight(db(), { pretrained: probe });

    expect(report.ok).toBe(true);
    expect(report.checks.find((c) => c.panelist === "pretrained")?.demand).toBe("optional");
  });

  it("refuses to start when a published problem requires a panelist it cannot run", async () => {
    // A design problem is C4, where the band is most of the grade. Grading one
    // without panelist 2 is a quiet halving of the evidence, repeated for
    // every learner, and nobody finds out until somebody audits the records.
    await publish("echo-the-question.yaml");
    await publish("argue-the-eval-plan.yaml");
    const { probe } = counting({ ok: false, reason: "model_missing" });

    const report = await preflight(db(), { pretrained: probe });

    expect(report.ok).toBe(false);
    const check = report.checks.find((c) => c.panelist === "pretrained")!;
    expect(check.demand).toBe("required");
    expect(check.ok).toBe(false);
    expect(check.reason).toBe("model_missing");
  });

  it("starts when the panelist the catalogue requires actually runs", async () => {
    await publish("argue-the-eval-plan.yaml");
    const { probe, state } = counting({ ok: true });

    const report = await preflight(db(), { pretrained: probe });

    expect(report.ok).toBe(true);
    // Once at boot, not once per problem. The probe loads a model.
    expect(state.calls).toBe(1);
  });

  it("counts only published problems", async () => {
    // Content in the database that nobody can reach is not a promise to
    // anybody. An author drafting a design problem must not stop the worker
    // that is grading this morning's code submissions.
    await publish("echo-the-question.yaml");
    await publish("argue-the-eval-plan.yaml", { publish: false });
    const { probe } = counting({ ok: false, reason: "model_missing" });

    expect((await preflight(db(), { pretrained: probe })).ok).toBe(true);
  });

  it("does not probe a panelist nothing in the catalogue needs", async () => {
    // The probe costs a model load. An empty catalogue has nothing to grade.
    const { probe, state } = counting({ ok: true });

    const report = await preflight(db(), { pretrained: probe });

    expect(state.calls).toBe(0);
    expect(report.ok).toBe(true);
    expect(report.checks.find((c) => c.panelist === "pretrained")?.demand).toBe("no");
  });

  it("reads a declared complexity rather than guessing from the artefact type", async () => {
    // Once the backfill lands a problem says its own level. A code problem
    // declared C4 is a code problem whose grade leans on the band.
    await publish("echo-the-question.yaml");
    await db().query(
      `update problem_version v set source_yaml = v.source_yaml || E'\\ncomplexity: C4\\n'
         from problem p where p.id = v.problem_id and p.slug = 'echo-the-question'`);
    const { probe } = counting({ ok: false, reason: "model_missing" });

    expect((await preflight(db(), { pretrained: probe })).ok).toBe(false);
  });
});

describe("what the operator reads", () => {
  it("names the next action rather than the failure", async () => {
    await publish("argue-the-eval-plan.yaml");
    const { probe } = counting({ ok: false, reason: "model_missing" });

    const report = await preflight(db(), { pretrained: probe });

    // .claude/rules/02-writing.md: a message that does not say what to do
    // next is not a message.
    expect(report.message).toContain("scripts/fetch_embedding_model.py");
    expect(report.message).toContain("EVAL_DEGRADED_PANELISTS");
    // And it says how much of the catalogue is affected, because an operator
    // choosing between fixing it and starting degraded needs the number.
    expect(report.message).toMatch(/1 of 2 published problems|1 published problem/);
  });

  it("says nothing alarming when everything the catalogue needs is present", async () => {
    await publish("argue-the-eval-plan.yaml");
    const { probe } = counting({ ok: true });

    const report = await preflight(db(), { pretrained: probe });

    expect(report.ok).toBe(true);
    expect(report.message).not.toContain("refus");
  });
});

describe("starting degraded is a decision somebody made, not a default", () => {
  it("starts when the operator named the panelist they are going without", async () => {
    await publish("argue-the-eval-plan.yaml");
    const { probe } = counting({ ok: false, reason: "model_missing" });

    const report = await preflight(db(), { pretrained: probe },
      { degraded: ["pretrained"] });

    expect(report.ok).toBe(true);
    expect(report.checks.find((c) => c.panelist === "pretrained")?.degraded).toBe(true);
    // Still says what was given up. An opt-out that prints nothing is the
    // silent degradation this exists to end.
    expect(report.message).toContain("pretrained");
  });

  it("ignores an opt-out naming a panelist that is working", async () => {
    await publish("argue-the-eval-plan.yaml");
    const { probe } = counting({ ok: true });

    const report = await preflight(db(), { pretrained: probe },
      { degraded: ["pretrained"] });

    expect(report.checks.find((c) => c.panelist === "pretrained")?.degraded).toBe(false);
  });

  it("reads the opt-out from the environment the operator sets", async () => {
    await publish("argue-the-eval-plan.yaml");
    const previous = process.env["EVAL_DEGRADED_PANELISTS"];
    process.env["EVAL_DEGRADED_PANELISTS"] = "pretrained";
    try {
      const { probe } = counting({ ok: false, reason: "model_missing" });
      expect((await preflight(db(), { pretrained: probe })).ok).toBe(true);
    } finally {
      if (previous === undefined) delete process.env["EVAL_DEGRADED_PANELISTS"];
      else process.env["EVAL_DEGRADED_PANELISTS"] = previous;
    }
  });

  it("refuses an opt-out that names something that is not a panelist", async () => {
    // A typo in an environment variable must not read as "everything is fine".
    // The probe passes here on purpose: with a failing probe the worker would
    // refuse anyway, and the test would prove nothing about the typo.
    await publish("argue-the-eval-plan.yaml");
    const { probe } = counting({ ok: true });

    const report = await preflight(db(), { pretrained: probe },
      { degraded: ["pretrianed"] as never });

    expect(report.ok).toBe(false);
    expect(report.message).toContain("pretrianed");
  });

  it("reads a list, so one good name does not excuse a bad one", async () => {
    await publish("argue-the-eval-plan.yaml");
    const { probe } = counting({ ok: false, reason: "model_missing" });

    const report = await preflight(db(), { pretrained: probe },
      { degraded: ["pretrained", "llmm"] as never });

    expect(report.ok).toBe(false);
    expect(report.message).toContain("llmm");
  });
});
