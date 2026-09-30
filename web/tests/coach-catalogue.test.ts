/**
 * Every coach script in the catalogue, checked against the problem's own
 * solutions. docs/04 section 2.
 *
 * Two properties make a coach worth having. It stays quiet on a correct answer,
 * because a coach that nags a right solution teaches learners to ignore it. And
 * it notices the mistake the problem exists for, because the naive solution is
 * that mistake written down. Both are checked with the idle, run and test state
 * neutral, which is what the coach sees the moment code appears.
 *
 * Each artefact has its own pair. A code problem has a reference and a naive
 * solution. A prompt problem starts the learner on the original prompt, which
 * is the mistake by definition, and has no reference edit to be quiet on. A
 * design problem has a strong exemplar and a weak one.
 */
import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { firing, NEUTRAL, readableCode } from "../lib/coach/engine.ts";
import { validateProblemYaml, type ParsedProblem } from "../lib/problems/validate.ts";

const PROBLEMS = path.join(import.meta.dirname, "..", "..", "problems");

async function catalogue() {
  const found: Array<{ file: string; dir: string; source: string }> = [];
  for (const track of await readdir(PROBLEMS, { withFileTypes: true })) {
    if (!track.isDirectory() || track.name === "_fixtures") continue;
    for (const entry of await readdir(path.join(PROBLEMS, track.name))) {
      if (!entry.endsWith(".yaml")) continue;
      const file = path.join(PROBLEMS, track.name, entry);
      found.push({ file, dir: file.replace(/\.yaml$/, ""), source: await readFile(file, "utf8") });
    }
  }
  return found;
}

async function parsed(): Promise<Array<{ name: string; problem: ParsedProblem }>> {
  const out: Array<{ name: string; problem: ParsedProblem }> = [];
  for (const { file, source } of await catalogue()) {
    const problem = validateProblemYaml(source, file).problem;
    if (problem?.kit.coach) out.push({ name: path.basename(file), problem });
  }
  return out;
}

function exemplar(problem: ParsedProblem, band: string): string | undefined {
  return problem.exemplars.find((e) => e.band === band)?.body_md;
}

describe("the catalogue these checks read", () => {
  // Every check below reads the parsed problem, and a file the validator
  // rejects has none, so a broken problem used to drop out of every coach
  // check without a word. Three content authors found the silence on 29
  // September 2026. Failing here names the file instead.
  it("validates in full, so no coach check skips a problem", async () => {
    const unread: string[] = [];
    for (const { file, source } of await catalogue()) {
      const report = validateProblemYaml(source, file);
      if (!report.problem?.kit.coach) {
        unread.push(`${path.basename(file)}: ${report.errors.map((e) => e.rule).join(", ") || "no coach"}`);
      }
    }
    expect(unread).toEqual([]);
  });
});

describe("every coach script in the catalogue", () => {
  it("stays quiet on the reference solution", async () => {
    const noisy: string[] = [];
    for (const { file, dir, source } of await catalogue()) {
      const coach = validateProblemYaml(source, file).problem?.kit.coach;
      const reference = path.join(dir, "reference_solution.py");
      if (!coach || !existsSync(reference)) continue;
      const code = readableCode("code", await readFile(reference, "utf8"));
      for (const signal of firing(coach, { ...NEUTRAL, code })) {
        noisy.push(`${path.basename(file)}: ${signal.id}`);
      }
    }
    expect(noisy).toEqual([]);
  });

  it("notices the mistake the naive solution makes", async () => {
    const silent: string[] = [];
    for (const { file, dir, source } of await catalogue()) {
      const coach = validateProblemYaml(source, file).problem?.kit.coach;
      const naive = path.join(dir, "naive_solution.py");
      if (!coach || !existsSync(naive)) continue;
      const code = readableCode("code", await readFile(naive, "utf8"));
      if (firing(coach, { ...NEUTRAL, code }).length === 0) silent.push(path.basename(file));
    }
    expect(silent).toEqual([]);
  });
});

describe("every prompt coach", () => {
  it("speaks up on the original prompt, which is where every learner starts", async () => {
    const silent: string[] = [];
    for (const { name, problem } of await parsed()) {
      if (problem.artefact_type !== "prompt" || !problem.original_prompt) continue;
      const state = { ...NEUTRAL, code: problem.original_prompt };
      if (firing(problem.kit.coach!, state).length === 0) silent.push(name);
    }
    expect(silent).toEqual([]);
  });
});

describe("every design coach", () => {
  it("stays quiet on the strong exemplar", async () => {
    const noisy: string[] = [];
    for (const { name, problem } of await parsed()) {
      const strong = problem.artefact_type === "design" ? exemplar(problem, "strong") : undefined;
      if (!strong) continue;
      for (const signal of firing(problem.kit.coach!, { ...NEUTRAL, code: strong })) {
        noisy.push(`${name}: ${signal.id}`);
      }
    }
    expect(noisy).toEqual([]);
  });

  it("notices what the weak exemplar gets wrong", async () => {
    const silent: string[] = [];
    for (const { name, problem } of await parsed()) {
      const weak = problem.artefact_type === "design" ? exemplar(problem, "weak") : undefined;
      if (!weak) continue;
      if (firing(problem.kit.coach!, { ...NEUTRAL, code: weak }).length === 0) silent.push(name);
    }
    expect(silent).toEqual([]);
  });
});
