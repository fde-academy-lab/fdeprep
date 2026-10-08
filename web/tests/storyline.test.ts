/**
 * The catalogue told as a learner's first 30 days as an FDE: every problem has
 * a day, a title that says what the client sees and a skill line. docs/04
 * section 1, as amended 30 September 2026. Problem addresses do not change, so no
 * link a learner saved breaks.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { publishableYamlFiles } from "../lib/problems/source.ts";
import { STORYLINE, validateProblemYaml, type ParsedProblem } from "../lib/problems/validate.ts";

const PROBLEMS = path.join(import.meta.dirname, "..", "..", "problems");

async function catalogue(): Promise<Array<{ file: string; source: string; problem: ParsedProblem }>> {
  const files = await publishableYamlFiles(PROBLEMS);
  return Promise.all(files.map(async (file) => {
    const source = await readFile(file, "utf8");
    const report = validateProblemYaml(source, file, { requireKit: true });
    expect(report.errors).toEqual([]);
    return { file, source, problem: report.problem! };
  }));
}

describe("the storyline across the catalogue", () => {
  it("uses every one of the 30 days, with three to five problems on each", async () => {
    const perDay = new Map<number, number>();
    for (const { problem } of await catalogue()) {
      if (problem.day === undefined) continue; // a drill, off the path
      perDay.set(problem.day, (perDay.get(problem.day) ?? 0) + 1);
    }
    expect([...perDay.keys()].sort((a, b) => a - b))
      .toEqual(Array.from({ length: STORYLINE.days }, (_, i) => i + 1));
    for (const count of perDay.values()) expect(count).toBeGreaterThanOrEqual(3);
    for (const count of perDay.values()) expect(count).toBeLessThanOrEqual(5);
  });

  it("walks the four stages in order, so day 1 is never a production problem", async () => {
    const order = ["foundations", "builder", "production", "fde"];
    const stageOf: Record<string, string> = {
      "loop": "foundations", "tools": "foundations", "harness": "foundations",
      "context": "builder", "memory": "builder", "orchestration": "builder",
      "guardrails": "production", "human-in-the-loop": "production", "evals": "production",
      "observability": "production", "agentic-pdlc": "fde", "agentic-sdlc": "fde",
      "builds": "fde", "fde-practice": "fde",
    };
    const rows = (await catalogue()).map(({ problem }) => problem)
      .filter((p) => p.day !== undefined)
      .sort((a, b) => a.day! - b.day!);
    const stages = rows.map((p) => order.indexOf(stageOf[p.track]!));
    expect(stages).toEqual([...stages].sort((a, b) => a - b));
  });

  it("keeps each build's stages in order across the days", async () => {
    const builds = new Map<string, Array<{ stage: number; day: number }>>();
    for (const { problem } of await catalogue()) {
      const build = problem.kit.build;
      if (!build) continue;
      expect(problem.day, `${problem.slug} is a build stage, so it stays on the path`).toBeDefined();
      builds.set(build.id, [...(builds.get(build.id) ?? []), { stage: build.stage, day: problem.day! }]);
    }
    expect(builds.size).toBeGreaterThan(0);
    for (const stages of builds.values()) {
      const days = stages.sort((a, b) => a.stage - b.stage).map((s) => s.day);
      expect(days).toEqual([...days].sort((a, b) => a - b));
    }
  });

  it("gives every problem its own title", async () => {
    const titles = (await catalogue()).map(({ problem }) => problem.title);
    expect(new Set(titles).size).toBe(titles.length);
  });
});

describe("the storyline rule", () => {
  const withField = (source: string, field: string, value: string | null) => {
    const lines = source.split("\n").filter((line) => !line.startsWith(`${field}:`));
    if (value === null) return lines.join("\n");
    const at = lines.findIndex((line) => line.startsWith("title:"));
    lines.splice(at + 1, 0, `${field}: ${value}`);
    return lines.join("\n");
  };

  it("refuses a catalogue problem with no day, and one past day 30", async () => {
    const { source, file } = (await catalogue()).find(({ source }) => !/^drill: true$/m.test(source))!;
    for (const day of [null, "0", "31", "2.5"]) {
      const report = validateProblemYaml(withField(source, "day", day), file, { requireKit: true });
      expect(report.errors.map((e) => e.rule)).toContain("no_storyline");
    }
  });

  it("lets a drill sit off the path, and refuses a drill that names a day", async () => {
    const { source, file } = (await catalogue()).find(({ source }) => !/^drill: true$/m.test(source))!;
    const rules = (yaml: string) =>
      validateProblemYaml(yaml, file, { requireKit: true }).errors.map((e) => e.rule);
    const drill = withField(withField(source, "day", null), "drill", "true");
    expect(rules(drill)).toEqual([]);
    expect(rules(withField(drill, "day", "12"))).toContain("no_storyline");
    expect(rules(withField(withField(source, "day", null), "drill", "false"))).toContain("no_storyline");
  });

  it("refuses a catalogue problem with no skill line", async () => {
    const { source, file } = (await catalogue())[0]!;
    const report = validateProblemYaml(withField(source, "skill", null), file, { requireKit: true });
    expect(report.errors.map((e) => e.rule)).toContain("no_storyline");
  });

  it("leaves a fixture alone, since it never reaches the catalogue", async () => {
    const { source, file } = (await catalogue())[0]!;
    const bare = withField(withField(source, "day", null), "skill", null);
    const report = validateProblemYaml(bare, file, { requireKit: false });
    expect(report.errors.map((e) => e.rule)).not.toContain("no_storyline");
  });

  it("carries the interview question through to the parsed problem", async () => {
    const { problem } = (await catalogue())[0]!;
    expect(problem.interview?.asked_as.length).toBeGreaterThan(0);
    expect(["written", "oral", "both"]).toContain(problem.interview?.round);
  });
});

/**
 * Amended 1 October 2026. A title names the task in plain words for a learner
 * meeting the topic for the first time, and the incident it used to carry
 * stays on the page as the scenario's headline.
 */
describe("titles a first-time learner can read", () => {
  it("names every task in eight words or fewer, starting with a capital", async () => {
    const long: string[] = [];
    for (const { problem } of await catalogue()) {
      const words = problem.title.trim().split(/\s+/).length;
      if (words > STORYLINE.titleWords || !/^[A-Z]/.test(problem.title)) long.push(problem.title);
    }
    expect(long).toEqual([]);
  });

  it("keeps the incident every title used to carry as the scenario headline", async () => {
    for (const { problem } of await catalogue()) {
      expect(problem.kit.scenario?.headline, problem.slug).toBeTruthy();
    }
  });

  it("refuses a ninth word in a title, and names the field the incident belongs in", async () => {
    const { file, source } = (await catalogue())[0]!;
    const long = source.replace(/^title: .*$/m,
      'title: "Stop an agent that keeps calling the model again and again"');
    const report = validateProblemYaml(long, file, { requireKit: true });
    expect(report.errors.map((e) => e.message).join("\n")).toMatch(/scenario\.headline/);
  });
});
