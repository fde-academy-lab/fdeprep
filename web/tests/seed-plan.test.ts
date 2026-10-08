/**
 * The seed plan, with no database. Bolt 1 of the seed brief.
 *
 * The plan is pure: the same day and the same catalogue plan the same rows.
 * These tests hold it to the shape the brief fixes and to the tier rules it
 * has to respect, because run.ts carries a plan out through the production
 * write paths and a plan that breaks a rule fails in the middle of a seed.
 *
 * The catalogue here is synthetic, in the published catalogue's proportions,
 * so the test does not move when an author adds a problem.
 */
import { describe, expect, it } from "vitest";
import { orderFor, PERSONAS, type Persona } from "../lib/policy/roadmap.ts";
import { tierFor, type Difficulty } from "../lib/policy/tiers.ts";
import { TRACKS } from "../lib/problems/vocabulary.ts";
import { ARCHETYPES, COHORTS, FIRST_GITHUB_ID, PEOPLE } from "../lib/seed/names.ts";
import {
  plan, type AttemptAction, type Catalogue, type CatalogueProblem, type SeedPlan,
} from "../lib/seed/plan.ts";

const TODAY = "2026-10-08";

/** 131 problems: 34 Easy, 53 Medium, 29 Hard, 15 Extreme; 105 code, 17 design, 9 prompt. */
function syntheticCatalogue(): Catalogue {
  const mix: Array<[Difficulty, number]> = [["easy", 34], ["medium", 53], ["hard", 29], ["extreme", 15]];
  const caps = new Map<Difficulty, number>([["easy", 1000], ["medium", 10], ["hard", 5], ["extreme", 1]]);
  const problems: CatalogueProblem[] = [];
  const rows: Array<{ id: number; slug: string; difficulty: Difficulty; track: string; artefact_type: string }> = [];
  let n = 0;
  let design = 0;
  let prompt = 0;
  for (const [difficulty, count] of mix) {
    for (let i = 0; i < count; i += 1) {
      n += 1;
      const artefactType = design < 17 && n % 7 === 3 ? "design"
        : prompt < 9 && n % 13 === 5 ? "prompt" : "code";
      if (artefactType === "design") design += 1;
      if (artefactType === "prompt") prompt += 1;
      const slug = `problem-${String(n).padStart(3, "0")}`;
      const track = TRACKS[n % TRACKS.length]!;
      // One end-to-end build of four code stages, so the build lock is exercised.
      const build = track === "builds" && artefactType === "code" && n < 60
        ? { id: "synthetic-build", stage: problems.filter((p) => p.build).length + 1 }
        : null;
      problems.push({
        slug, difficulty, artefactType, hints: artefactType === "design" ? 0 : 3,
        callBudget: artefactType === "code" ? 6 : null, submitCap: caps.get(difficulty)!,
        hasDefence: artefactType === "code", build,
      });
      rows.push({ id: n, slug, difficulty, track, artefact_type: artefactType });
    }
  }
  const paths = Object.fromEntries(PERSONAS.map((persona) =>
    [persona, orderFor(persona, rows).map((row) => row.slug)])) as Record<Persona, string[]>;
  const questions = Array.from({ length: 12 }, (_, i) => ({
    slug: `question-${i + 1}`, totalSeconds: 120 + i * 5, beats: 5,
    bands: ["adequate", "strong", "weak"] as const, followUps: i % 3 === 0 ? 0 : 2,
  }));
  return { problems, paths, questions };
}

const catalogue = syntheticCatalogue();
const full = plan({ today: TODAY, catalogue });
const problems = new Map(catalogue.problems.map((p) => [p.slug, p]));

function attempts(p: SeedPlan): Array<AttemptAction & { login: string; daysAgo: number }> {
  return p.sittings.flatMap((s) => s.actions
    .filter((a): a is AttemptAction => a.type === "attempt")
    .map((a) => ({ ...a, login: s.login, daysAgo: s.daysAgo })));
}

describe("the people", () => {
  it("are forty, each with a unique login, name and GitHub id", () => {
    expect(PEOPLE).toHaveLength(40);
    expect(new Set(PEOPLE.map((p) => p.login)).size).toBe(40);
    expect(new Set(PEOPLE.map((p) => p.displayName)).size).toBe(40);
    expect(PEOPLE.map((p) => p.githubId))
      .toEqual(Array.from({ length: 40 }, (_, i) => FIRST_GITHUB_ID + i));
  });

  it("split 14 builders, 18 navigators and 8 accelerators, 24 in Cohort 3 and 16 in Cohort 4", () => {
    const count = (f: (p: (typeof PEOPLE)[number]) => boolean) => PEOPLE.filter(f).length;
    expect(count((p) => p.persona === "builder")).toBe(14);
    expect(count((p) => p.persona === "navigator")).toBe(18);
    expect(count((p) => p.persona === "accelerator")).toBe(8);
    expect(count((p) => p.cohort === "c3")).toBe(24);
    expect(count((p) => p.cohort === "c4")).toBe(16);
  });

  it("carry one faculty member per cohort, one admin in Cohort 3, two paused and one ended", () => {
    for (const cohort of COHORTS) {
      expect(PEOPLE.filter((p) => p.cohort === cohort.key && p.role === "faculty")).toHaveLength(1);
    }
    expect(PEOPLE.filter((p) => p.role === "admin").map((p) => p.cohort)).toEqual(["c3"]);
    expect(PEOPLE.filter((p) => p.state === "paused")).toHaveLength(2);
    expect(PEOPLE.filter((p) => p.state === "ended")).toHaveLength(1);
  });

  it("puts at least four learners of each archetype in Cohort 3 and two in Cohort 4", () => {
    for (const archetype of ARCHETYPES) {
      const learners = PEOPLE.filter((p) => p.role === "learner" && p.archetype === archetype);
      expect(learners.filter((p) => p.cohort === "c3").length).toBeGreaterThanOrEqual(4);
      expect(learners.filter((p) => p.cohort === "c4").length).toBeGreaterThanOrEqual(2);
    }
  });

  it("names one learner per persona for the hand-computed readiness", () => {
    const named = PEOPLE.filter((p) => p.named).sort((a, b) => a.named! - b.named!);
    expect(named.map((p) => p.persona)).toEqual(["builder", "navigator", "accelerator"]);
  });

  it("puts six learners in the test plan, every archetype among them", () => {
    const six = PEOPLE.filter((p) => p.inTestPlan);
    expect(six).toHaveLength(6);
    expect(new Set(six.map((p) => p.archetype))).toEqual(new Set(ARCHETYPES));
  });
});

describe("the full plan", () => {
  it("plans the same rows from the same day and catalogue", () => {
    expect(plan({ today: TODAY, catalogue })).toEqual(full);
  });

  it("has the shape the brief fixes", () => {
    const e = full.expected;
    expect(e.people).toBe(40);
    // "About 1,100 over 90 days."
    expect(e.submissions).toBeGreaterThan(850);
    expect(e.submissions).toBeLessThan(1400);
    // "About 160 sessions."
    expect(e.voiceSessions).toBeGreaterThan(120);
    expect(e.voiceSessions).toBeLessThan(200);
    expect(e.rehearsals).toBe(14);
    expect(e.unfinishedRehearsals).toBe(2);
    expect(e.consents).toBe(30);
    expect(e.invites).toEqual({ pending: 2, used: 2, withdrawn: 1, expired: 1 });
    expect(e.personaChanges).toBe(3);
    expect(e.disagreements).toEqual({ open: 9, upheld: 2, overridden: 1 });
    expect(e.stuck).toEqual({ submissions: 4, voiceNotScored: 2, voiceGaveUp: 2 });
    expect(e.refusedRetries).toBe(1);
  });

  it("answers every published question, four in pressure and eight that do not count", () => {
    const voice = full.sittings.flatMap((s) => s.actions).filter((a) => a.type === "voice");
    expect(new Set(voice.map((v) => v.question)).size).toBe(12);
    expect(voice.filter((v) => v.mode === "pressure")).toHaveLength(4);
    expect(voice.filter((v) => v.short)).toHaveLength(8);
    expect(voice.filter((v) => v.mode === "pressure" || v.short)
      .every((v) => v.input === "spoken")).toBe(true);
  });

  it("leaves the new learners at zero attempts", () => {
    const fresh = new Set(PEOPLE.filter((p) => p.archetype === "new").map((p) => p.login));
    expect(attempts(full).filter((a) => fresh.has(a.login))).toEqual([]);
  });

  it("orders sittings oldest first", () => {
    const days = full.sittings.map((s) => s.daysAgo);
    expect(days).toEqual([...days].sort((a, b) => b - a));
  });
});

describe("the tier rules the plan has to respect", () => {
  it("reveals hints only where the tier opens them on failed runs alone", () => {
    for (const a of attempts(full).filter((x) => x.hints > 0)) {
      const rule = tierFor(problems.get(a.slug)!.difficulty).hints;
      expect(["free", "after_failed_runs"]).toContain(rule.kind);
      if (rule.kind === "after_failed_runs") expect(a.runs).toBeGreaterThanOrEqual(rule.failedRuns);
      expect(a.outcome).toBe("hinted");
    }
  });

  it("writes a learner test first wherever the tier asks for one", () => {
    const written = new Set<string>();
    for (const a of attempts(full)) {
      const problem = problems.get(a.slug)!;
      if (tierFor(problem.difficulty).requiresLearnerTests && problem.artefactType === "code") {
        expect(written.has(`${a.login}:${a.slug}`) || a.learnerTest).toBe(true);
        written.add(`${a.login}:${a.slug}`);
      }
    }
    expect(written.size).toBeGreaterThan(0);
  });

  it("follows a pass with a defence exactly where the tier asks for one", () => {
    for (const a of attempts(full)) {
      const problem = problems.get(a.slug)!;
      const passed = ["clean", "hinted", "over_budget"].includes(a.outcome);
      const wanted = passed && problem.artefactType === "code" && problem.hasDefence &&
        tierFor(problem.difficulty).requiresDefence;
      expect(a.defence !== undefined).toBe(wanted);
    }
  });

  it("never plans a pass over budget where a defence follows", () => {
    for (const a of attempts(full).filter((x) => x.outcome === "over_budget")) {
      expect(tierFor(problems.get(a.slug)!.difficulty).requiresDefence).toBe(false);
    }
  });

  it("spaces submits two days apart on a problem that allows one a day", () => {
    const last = new Map<string, number>();
    for (const a of attempts(full)) {
      if (problems.get(a.slug)!.submitCap !== 1) continue;
      const key = `${a.login}:${a.slug}`;
      if (last.has(key)) expect(last.get(key)! - a.daysAgo).toBeGreaterThanOrEqual(2);
      last.set(key, a.daysAgo);
    }
  });

  it("never opens a build stage before the stage behind it passes", () => {
    const passed = new Map<string, Set<string>>();
    let opened = 0;
    for (const a of attempts(full)) {
      const problem = problems.get(a.slug)!;
      const mine = passed.get(a.login) ?? new Set<string>();
      if (problem.build && problem.build.stage > 1) {
        const previous = catalogue.problems.find((p) =>
          p.build?.id === problem.build!.id && p.build.stage === problem.build!.stage - 1)!;
        expect(mine.has(previous.slug)).toBe(true);
        opened += 1;
      }
      if (["clean", "hinted", "over_budget"].includes(a.outcome)) mine.add(a.slug);
      passed.set(a.login, mine);
    }
    // Not vacuous: somebody reached a later stage.
    expect(opened).toBeGreaterThan(0);
  });

  it("refuses exactly one retry, on a problem that allows one submit a day", () => {
    const refused = attempts(full).filter((a) => a.refusedRetry);
    expect(refused).toHaveLength(1);
    expect(problems.get(refused[0]!.slug)!.submitCap).toBe(1);
    expect(refused[0]!.outcome).toBe("fail");
  });
});
