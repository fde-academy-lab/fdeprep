/**
 * End-to-end build order. A stage's starter code carries the stage before it as
 * working code, so stage N opens only once stage N-1 has passed or been given
 * up. The page withholds the stage and the submission path refuses it; both
 * ask lib/policy the same question.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../lib/db/pool.ts";
import { resolvePolicy } from "../lib/policy/index.ts";
import { publishImport } from "../lib/problems/import.ts";
import { validateProblemYaml } from "../lib/problems/validate.ts";
import { createSubmission, GateRefused } from "../lib/submissions/create.ts";
import { FIXTURES, resetDatabase, seedLearner } from "./helpers.ts";

let learner: Awaited<ReturnType<typeof seedLearner>>;

async function stage(n: number): Promise<number> {
  const base = await readFile(path.join(FIXTURES, "echo-the-question.yaml"), "utf8");
  const source = base.replace(/^slug: .*$/m, `slug: a-build-stage-${n}`) +
    `\nbuild: { id: a-build, title: "Ship a thing", stage: ${n}, of: 3 }\n`;
  const report = validateProblemYaml(source, `stage-${n}.yaml`);
  if (!report.problem) throw new Error(JSON.stringify(report.errors));
  return (await publishImport(report.problem, source, { publish: true })).problemId;
}

async function finish(problemId: number, how: "solved_at" | "gave_up_at"): Promise<void> {
  await db().query(
    `insert into attempt (enrolment_id, problem_id, cohort_id, ${how}) values ($1, $2, $3, now())
     on conflict (enrolment_id, problem_id) do update set ${how} = now()`,
    [learner.enrolmentId, problemId, learner.cohortId]);
}

beforeEach(async () => {
  await resetDatabase();
  learner = await seedLearner();
});

afterAll(async () => {
  await closeDb();
});

describe("a build stage", () => {
  it("leaves stage one open", async () => {
    const first = await stage(1);
    const policy = await resolvePolicy({ enrolmentId: learner.enrolmentId, problemId: first });
    expect(policy.locked).toBeNull();
    expect(policy.run.allowed).toBe(true);
  });

  it("locks stage two until stage one passes, and says which stage to finish", async () => {
    const first = await stage(1);
    const second = await stage(2);
    const locked = await resolvePolicy({ enrolmentId: learner.enrolmentId, problemId: second });
    expect(locked.locked?.previous.slug).toBe("a-build-stage-1");
    expect(locked.run.allowed).toBe(false);
    expect(locked.submit.allowed).toBe(false);
    expect(locked.hints.allowed).toBe(false);
    expect(locked.coach.enabled).toBe(false);
    expect(locked.run.reason).toMatch(/Stage 2 opens once stage 1/);

    await finish(first, "solved_at");
    const open = await resolvePolicy({ enrolmentId: learner.enrolmentId, problemId: second });
    expect(open.locked).toBeNull();
    expect(open.run.allowed).toBe(true);
  });

  it("refuses a run on a locked stage at the submission boundary", async () => {
    await stage(1);
    const second = await stage(2);
    await expect(createSubmission({
      enrolmentId: learner.enrolmentId, cohortId: learner.cohortId, problemId: second,
      kind: "run", body: "def run_agent(question, llm, tools):\n    return 'x'\n",
    } as Parameters<typeof createSubmission>[0])).rejects.toBeInstanceOf(GateRefused);
    const { rows } = await db().query("select count(*)::int as n from attempt");
    expect(rows[0]!.n).toBe(0);
  });

  it("opens after a give-up, since the walkthrough has already been read", async () => {
    const first = await stage(1);
    const second = await stage(2);
    await finish(first, "gave_up_at");
    expect((await resolvePolicy({ enrolmentId: learner.enrolmentId, problemId: second })).locked)
      .toBeNull();
  });

  it("stays open to faculty, who review every stage", async () => {
    await stage(1);
    const second = await stage(2);
    await db().query("update enrolment set role = 'faculty' where id = $1", [learner.enrolmentId]);
    expect((await resolvePolicy({ enrolmentId: learner.enrolmentId, problemId: second })).locked)
      .toBeNull();
  });

  it("does not apply inside a rehearsal, which draws problems whole", async () => {
    await stage(1);
    const second = await stage(2);
    const policy = await resolvePolicy({
      enrolmentId: learner.enrolmentId, problemId: second, rehearsal: true,
    });
    expect(policy.locked).toBeNull();
  });
});
