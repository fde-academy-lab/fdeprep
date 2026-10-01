/**
 * The live coach behind POST /api/problems/:id/coach. docs/04 section 2.1 and
 * docs/00 section 3.2 as amended.
 *
 * Written before the route. What these pin down: the coach reads the code the
 * browser sends and everything else from the database; it says one sentence
 * an author wrote and never a test name; Hard and Extreme hold code-reading
 * nudges back until failed runs; a pass turns it into the wrap-up; and a
 * rehearsal turns it off.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "../lib/db/pool.ts";
import { coachReply } from "../lib/coach/state.ts";
import { publishImport } from "../lib/problems/import.ts";
import { validateProblemYaml } from "../lib/problems/validate.ts";
import { resetDatabase, seedLearner } from "./helpers.ts";

const PROBLEMS = path.join(import.meta.dirname, "..", "..", "problems");
const EASY = "tools/dispatch-only-registered-actions";
// Re-tiered on 1 October 2026: bind-approval is Hard now, and this build stage
// is one of the Extreme code problems that kept its tier.
const EXTREME = "builds/incident-investigator-4-resume-without-paging-twice";

let learner: Awaited<ReturnType<typeof seedLearner>>;

async function publish(relative: string): Promise<number> {
  const source = await readFile(path.join(PROBLEMS, `${relative}.yaml`), "utf8");
  const report = validateProblemYaml(source, relative);
  if (!report.problem) throw new Error(JSON.stringify(report.errors));
  return (await publishImport(report.problem, source, { publish: true })).problemId;
}

const solution = (relative: string, which: "reference" | "naive") =>
  readFile(path.join(PROBLEMS, relative, `${which}_solution.py`), "utf8");

async function attemptFor(problemId: number): Promise<number> {
  const { rows } = await db().query<{ id: string }>(
    `insert into attempt (enrolment_id, problem_id, cohort_id) values ($1, $2, $3)
     on conflict (enrolment_id, problem_id) do update set hints_used = attempt.hints_used
     returning id`,
    [learner.enrolmentId, problemId, learner.cohortId]);
  return Number(rows[0]!.id);
}

/** A graded run, written the way the result writer leaves it. */
async function gradedRun(problemId: number, verdict: "pass" | "fail",
                         failed: { gate: string; name: string }[] = []): Promise<void> {
  const attemptId = await attemptFor(problemId);
  const gates: Record<string, { cases: Array<{ name: string; status: string }> }> = {};
  for (const { gate, name } of failed) {
    (gates[gate] ??= { cases: [] }).cases.push({ name, status: "fail" });
  }
  await db().query(
    `insert into submission (attempt_id, problem_version_id, kind, body, body_sha256, status,
                             verdict, result, finished_at)
     select $1, v.id, 'run', 'x', md5(random()::text), 'terminal', $3::verdict, $4, now()
       from problem p join problem_version v on v.problem_id = p.id and v.version = p.current_version
      where p.id = $2`,
    [attemptId, problemId, verdict, JSON.stringify({ gates })]);
}

const ask = (problemId: number, code: string, extra: Partial<{
  idleMinutes: number; dismissed: string[];
}> = {}) => coachReply({
  enrolmentId: learner.enrolmentId, problemId, code,
  idleMinutes: extra.idleMinutes ?? 0, dismissed: extra.dismissed ?? [],
});

beforeEach(async () => {
  await resetDatabase();
  learner = await seedLearner();
});

afterAll(async () => {
  await closeDb();
});

describe("on an Easy problem", () => {
  it("speaks up on the naive solution the moment it appears", async () => {
    const id = await publish(EASY);
    const reply = await ask(id, await solution(EASY, "naive"));
    expect(reply.enabled).toBe(true);
    expect(reply.nudge?.say).toMatch(/\S/);
  });

  it("stays quiet on the reference solution", async () => {
    const id = await publish(EASY);
    expect((await ask(id, await solution(EASY, "reference"))).nudge).toBeNull();
  });

  it("skips a nudge the learner dismissed and says the next one", async () => {
    const id = await publish(EASY);
    const first = await ask(id, "def run_agent(question, llm, tools):\n    pass\n");
    expect(first.nudge?.id).toBe("no-final-answer");
    const second = await ask(id, "def run_agent(question, llm, tools):\n    pass\n", {
      dismissed: ["no-final-answer"],
    });
    expect(second.nudge?.id).not.toBe("no-final-answer");
  });

  it("reads the code without its comment lines, so a TODO cannot answer for the code", async () => {
    const id = await publish(EASY);
    const stub = "def run_agent(question, llm, tools):\n" +
      "    # TODO 1: return the text when the reply is a Final Answer\n    pass\n";
    expect((await ask(id, stub)).nudge?.id).toBe("no-final-answer");
  });

  it("still says where to look after a failed run that no authored signal covers", async () => {
    const id = await publish(EASY);
    await gradedRun(id, "fail", [{ gate: "public", name: "calls_a_registered_tool" }]);
    await db().query(
      `update submission set result = jsonb_set(result, '{gates,public}',
         '{"total": 2, "passed": 1, "cases": [{"name": "calls_a_registered_tool", "status": "fail"}]}')`);
    const reply = await ask(id, await solution(EASY, "reference"));
    expect(reply.nudge?.id).toMatch(/^run-\d+$/);
    expect(reply.nudge?.say).toMatch(/1 of 2 public tests failed/);
    const later = await ask(id, await solution(EASY, "reference"), { dismissed: [reply.nudge!.id] });
    expect(later.nudge).toBeNull();
  });

  it("names what a failed hidden test was about without naming the test", async () => {
    const id = await publish(EASY);
    await gradedRun(id, "fail", [{ gate: "hidden", name: "an_invented_tool_is_refused_not_raised" }]);
    const reply = await ask(id, await solution(EASY, "reference"));
    expect(reply.nudge?.id).toBe("hidden-invented-tool");
    expect(JSON.stringify(reply)).not.toContain("an_invented_tool_is_refused_not_raised");
  });

  it("nudges a learner who has sat idle", async () => {
    const id = await publish(EASY);
    const reference = await solution(EASY, "reference");
    expect((await ask(id, reference, { idleMinutes: 1 })).nudge).toBeNull();
    expect((await ask(id, reference, { idleMinutes: 10 })).nudge?.id).toBe("stuck");
  });

  it("turns into the wrap-up once the problem is passed", async () => {
    const id = await publish(EASY);
    const attemptId = await attemptFor(id);
    await db().query("update attempt set solved_at = now() where id = $1", [attemptId]);
    const reply = await ask(id, await solution(EASY, "naive"));
    expect(reply.nudge).toBeNull();
    expect(reply.wrapUp).toMatch(/allowlist/);
  });
});

describe("on an Extreme problem", () => {
  it("holds code-reading nudges back until two runs have failed", async () => {
    const id = await publish(EXTREME);
    const naive = await solution(EXTREME, "naive");
    expect((await ask(id, naive)).nudge).toBeNull();
    await gradedRun(id, "fail");
    expect((await ask(id, naive)).nudge).toBeNull();
    await gradedRun(id, "fail");
    expect((await ask(id, naive)).nudge).not.toBeNull();
  });

  it("still speaks about a failed test before the code nudges open", async () => {
    const id = await publish(EXTREME);
    await gradedRun(id, "fail", [
      { gate: "hidden", name: "a_page_that_went_out_before_the_crash_is_not_sent_again" }]);
    const reply = await ask(id, await solution(EXTREME, "naive"));
    expect(reply.nudge?.id).toBe("paged-twice");
  });
});

describe("in a rehearsal", () => {
  it("is off, because an interviewer does not coach", async () => {
    const id = await publish(EASY);
    await db().query(
      `insert into rehearsal (enrolment_id, ends_at, problem_ids)
       values ($1, now() + interval '1 hour', array[$2::bigint])`,
      [learner.enrolmentId, id]);
    const reply = await ask(id, await solution(EASY, "naive"));
    expect(reply).toEqual({ nudge: null, wrapUp: null, enabled: false });
  });
});
