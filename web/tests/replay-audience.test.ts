/**
 * docs/01 S7 and docs/03 section 5, as decided on 8 October 2026: a learner's
 * replay shows each public case in full and each hidden or adversarial case as
 * an anonymous row in the place it ran, saying how it ended and nothing it
 * held. Faculty and admins read every case in full.
 *
 * Found on 8 October 2026 by reading. The runner put every case that ran into
 * the trace, the result writer stored it whole, and the replay returned every
 * case's steps to whoever opened it. A learner read each hidden and
 * adversarial case's name, the prompts their code built from its input, the
 * scripted model's replies, and every tool argument and output, which is the
 * fixture's script that docs/01 S4 says a learner never sees.
 *
 * Written before the fix. What these pin down: the replay is filtered on the
 * server, so nothing of an unpublished case reaches a learner's browser; each
 * row sits where its case ran and counts the way the tier counts, one row per
 * case where the tier shows the hidden count and one per battery where it
 * shows none; the fixture author's note still reaches the learner once the
 * attempt closes; faculty read everything; and the stored trace stays whole.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import ReplayView from "../app/(shell)/traces/[id]/replay.tsx";
import { closeDb, db } from "../lib/db/pool.ts";
import { createSubmission } from "../lib/submissions/create.ts";
import { resolvePolicy } from "../lib/policy/index.ts";
import { dispatchOnce } from "../lib/queue/dispatcher.ts";
import { runOnce, writeResultsOnce } from "../lib/queue/runner-worker.ts";
import { writeResult } from "../lib/queue/result-writer.ts";
import { deleteMessage, receive } from "../lib/queue/shim.ts";
import { replayFor, type Replay } from "../lib/trace/replay.ts";
import { loadTrace, storeTrace } from "../lib/trace/store.ts";
import { importFixtures, resetDatabase, seedLearner } from "./helpers.ts";

/** Extreme, which shows nothing about the tests. Two public, two hidden, one adversarial. */
const EXTREME = "survive-the-hostile-tool";
/** Medium, which shows the hidden count. Two public cases and two hidden. */
const MEDIUM = "retry-once-then-degrade";

/**
 * Everything the Extreme fixture keeps unpublished: names, inputs, the
 * scripted model's replies and the tool arguments and outputs.
 */
const EXTREME_SECRETS = [
  "hidden_one", "hidden_two", "adversarial_injection",
  "case 3 for survive-the-hostile-tool", "case 4 for survive-the-hostile-tool", "check order 99",
  "done 3", "done 4", "id=3", "id=4", "id=99", "CANARY_7731",
];

/** Pastes raw tool output into the prompt: clears the ordinary cases and follows the injection. */
const PASTES_TOOL_OUTPUT = `
def run_agent(question, llm, tools):
    scratchpad = "Question: " + question + "\\n"
    probe = tools["probe"]
    for _ in range(4):
        output = llm(scratchpad)
        if "Final Answer:" in output:
            return output.split("Final Answer:", 1)[1].strip()
        result = probe(id=1)
        scratchpad += "Observation: " + str(result) + "\\n"
    return "I could not complete this request."
`.trim();

let learner: Awaited<ReturnType<typeof seedLearner>>;

beforeEach(async () => {
  await resetDatabase();
  await importFixtures();
  learner = await seedLearner();
});

afterAll(async () => {
  await closeDb();
});

async function problemId(slug: string): Promise<number> {
  const { rows } = await db().query<{ id: string }>("select id from problem where slug = $1", [slug]);
  return Number(rows[0]!.id);
}

async function writeLearnerTest(id: number): Promise<void> {
  const { rows: [attempt] } = await db().query<{ id: string }>(
    `insert into attempt (enrolment_id, problem_id, cohort_id) values ($1, $2, $3)
     on conflict (enrolment_id, problem_id) do update set problem_id = excluded.problem_id
     returning id`, [learner.enrolmentId, id, learner.cohortId]);
  await db().query("insert into learner_test (attempt_id, body) values ($1, $2)",
    [attempt!.id, "def test_answers():\n    assert run_agent('q', llm, tools)"]);
}

/** A submit through the real runner on this machine. */
async function submitThroughRunner(slug: string, body: string): Promise<number> {
  const id = await problemId(slug);
  const policy = await resolvePolicy({ enrolmentId: learner.enrolmentId, problemId: id });
  if (policy.learnerTests.required) await writeLearnerTest(id);
  const created = await createSubmission({
    enrolmentId: learner.enrolmentId, cohortId: learner.cohortId, problemId: id,
    kind: "submit", body,
  });
  await dispatchOnce();
  await runOnce();
  await writeResultsOnce();
  return created.id;
}

/** A submit whose result, trace included, is scripted, and no runner runs it. */
async function submitScripted(slug: string, result: Record<string, unknown>): Promise<number> {
  const id = await problemId(slug);
  const created = await createSubmission({
    enrolmentId: learner.enrolmentId, cohortId: learner.cohortId, problemId: id,
    kind: "submit", body: `def run_agent(question, llm, tools):\n    return question  # ${Math.random()}\n`,
  });
  await dispatchOnce();
  const message = (await receive("submissions", 10))
    .find((m) => Number(m.body["submission_id"]) === created.id)!;
  expect(await writeResult({
    submission_id: created.id,
    lease_token: String(message.body["lease_token"]),
    fencing_token: Number(message.body["fencing_token"]),
    body_sha256: String(message.body["body_sha256"]),
    result,
  })).toBe(true);
  await deleteMessage(message.id);
  return created.id;
}

const closeAttempt = (submissionId: number) => db().query(
  `update attempt set gave_up_at = now()
    where id = (select attempt_id from submission where id = $1)`, [submissionId]);

/**
 * One scripted case: a model call carrying `prompt`, a tool call and a final
 * answer. `ran` is what the runner writes beside a case since the fix, and a
 * trace stored before it carries neither key.
 */
function traced(name: string, prompt: string,
                ran: { battery?: string; status?: string } = {}, flags: string[] = []) {
  return {
    name, ...ran,
    trace: {
      steps: [
        { seq: 1, type: "llm_call", prompt, prompt_chars: prompt.length, response: "Action: track(id=7)", ms: 0 },
        { seq: 2, type: "tool_call", tool: "track", args: { id: 7, note: prompt }, ms: 1 },
        { seq: 3, type: "final", value: `answered ${prompt}` },
      ],
      flags,
      truncated: false,
    },
  };
}

/** The Medium fixture's submit: both public cases pass, one hidden case fails. */
function mediumResult(trace: Record<string, unknown>): Record<string, unknown> {
  return {
    verdict: "fail", score: 65,
    gates: {
      static: { status: "pass", reasons: [] },
      public: { status: "pass", passed: 2, total: 2,
                cases: [{ name: "public_one", status: "pass", message: null },
                        { name: "public_two", status: "pass", message: null }] },
      hidden: { status: "fail", passed: 1, total: 2, cases: [] },
      adversarial: { status: "skipped", passed: 0, total: 0, cases: [] },
    },
    steps: [],
    budget: { llm_calls: 1, tool_calls: 1, wall_ms: 20, max_llm_calls: 6, within_budget: true },
    trace,
    runner: { image_tag: "runner:test", duration_ms: 30 },
  };
}

const withheld = (replay: Replay) => replay.steps.filter((s) => s.type === "withheld");
const shownCases = (replay: Replay) =>
  [...new Set(replay.steps.filter((s) => s.type !== "withheld").map((s) => s.caseName))];

describe("a learner's replay of an Extreme submission, through the real runner", () => {
  it("shows the public cases in full and nothing any unpublished case held", async () => {
    const id = await submitThroughRunner(EXTREME, PASTES_TOOL_OUTPUT);
    const replay = await replayFor(id);

    expect(replay.audience).toBe("learner");
    expect(replay.available).toBe(true);
    expect(shownCases(replay)).toEqual(["public_one", "public_two"]);
    const text = JSON.stringify(replay);
    for (const secret of EXTREME_SECRETS) expect(text, secret).not.toContain(secret);
    // The injection was followed in the adversarial case. Its flag is about
    // that case, so it stays with the case.
    expect(replay.flags).not.toContain("injection_followed");
  }, 120_000);

  it("gives each unpublished battery one row, after the public cases, with no count", async () => {
    const id = await submitThroughRunner(EXTREME, PASTES_TOOL_OUTPUT);
    const replay = await replayFor(id);

    expect(withheld(replay).map((s) => ({ battery: s.battery, status: s.caseStatus, summary: s.summary })))
      .toEqual([
        { battery: "hidden", status: "pass", summary: "Hidden cases: every one passed" },
        { battery: "adversarial", status: "fail", summary: "Adversarial cases: at least one failed" },
      ]);
    expect(withheld(replay).every((s) => s.caseName === null && !/\d/.test(s.summary))).toBe(true);
    const firstWithheld = replay.steps.findIndex((s) => s.type === "withheld");
    expect(replay.steps.slice(firstWithheld).every((s) => s.type === "withheld")).toBe(true);
    // The header counts what the learner can walk through.
    const publicCalls = replay.steps.filter((s) => s.type === "llm_call").length;
    expect(replay.llmCalls).toBe(publicCalls);
  }, 120_000);

  it("keeps the fixture author's note until the attempt closes, then gives it to the row", async () => {
    const id = await submitThroughRunner(EXTREME, PASTES_TOOL_OUTPUT);
    expect(withheld(await replayFor(id)).every((s) => s.fixtureAnnotation === null)).toBe(true);

    await closeAttempt(id);
    const replay = await replayFor(id);
    const adversarial = withheld(replay).find((s) => s.battery === "adversarial")!;
    expect(adversarial.fixtureAnnotation).toMatch(/pastes raw tool output/);
    for (const secret of EXTREME_SECRETS) expect(JSON.stringify(replay), secret).not.toContain(secret);
  }, 120_000);

  it("gives faculty every case in full, with its battery and outcome, and keeps the trace whole", async () => {
    const id = await submitThroughRunner(EXTREME, PASTES_TOOL_OUTPUT);
    const replay = await replayFor(id, { audience: "faculty" });

    expect(replay.audience).toBe("faculty");
    expect(withheld(replay)).toEqual([]);
    expect(shownCases(replay)).toEqual(
      ["public_one", "public_two", "hidden_one", "hidden_two", "adversarial_injection"]);
    const injected = replay.steps.filter((s) => s.caseName === "adversarial_injection");
    expect(injected.every((s) => s.battery === "adversarial" && s.caseStatus === "fail")).toBe(true);
    expect(JSON.stringify(replay)).toContain("CANARY_7731");
    expect(replay.flags).toContain("injection_followed");
    // Faculty read the author's note without waiting for the attempt.
    expect(injected.some((s) => s.fixtureAnnotation !== null)).toBe(true);

    const stored = await loadTrace(id);
    const cases = stored!.body["cases"] as Array<Record<string, unknown>>;
    expect(cases.map((c) => [c["name"], c["battery"], c["status"]])).toEqual([
      ["public_one", "public", "pass"], ["public_two", "public", "pass"],
      ["hidden_one", "hidden", "pass"], ["hidden_two", "hidden", "pass"],
      ["adversarial_injection", "adversarial", "fail"],
    ]);
  }, 120_000);
});

describe("a learner's replay on a tier that shows the hidden count", () => {
  it("gives each hidden case its own numbered row, in the place it ran", async () => {
    const id = await submitScripted(MEDIUM, mediumResult({ cases: [
      traced("public_one", "Question: the first public question", { battery: "public", status: "pass" }),
      traced("public_two", "Question: the second public question", { battery: "public", status: "pass" }),
      traced("hidden_one", "Question: the first secret question",
             { battery: "hidden", status: "pass" }, ["soft_error"]),
      traced("hidden_two", "Question: the second secret question", { battery: "hidden", status: "fail" }),
    ] }));
    const replay = await replayFor(id);

    expect(replay.steps.map((s) => s.type === "withheld" ? s.summary : s.caseName)).toEqual([
      "public_one", "public_one", "public_one", "public_two", "public_two", "public_two",
      "Hidden case 1 of 2: passed", "Hidden case 2 of 2: failed",
    ]);
    expect(withheld(replay).map((s) => [s.battery, s.caseStatus, s.detail, s.flags]))
      .toEqual([["hidden", "pass", {}, []], ["hidden", "fail", {}, []]]);
    const text = JSON.stringify(replay);
    for (const secret of ["hidden_one", "hidden_two", "secret question"]) {
      expect(text, secret).not.toContain(secret);
    }
    expect(replay.flags).toEqual([]);
    expect(replay.toolCalls).toBe(2);

    // What the page draws from it: the rows under their own heading, and no
    // secret, since none reached the props.
    const page = renderToStaticMarkup(createElement(ReplayView, { replay }));
    expect(page).toContain("Cases you cannot see");
    expect(page).toContain("Hidden case 2 of 2: failed");
    expect(page).not.toContain("secret question");
  });

  it("reads a trace stored before the fix by the problem's own case list", async () => {
    // No battery and no outcome on any case, which is every trace written
    // before 8 October 2026. The outcome of each hidden case is unknown when
    // only some of them passed.
    const id = await submitScripted(MEDIUM, mediumResult({ cases: [
      traced("public_one", "Question: the first public question"),
      traced("public_two", "Question: the second public question"),
      traced("hidden_one", "Question: the first secret question"),
      traced("hidden_two", "Question: the second secret question"),
    ] }));
    const replay = await replayFor(id);

    expect(shownCases(replay)).toEqual(["public_one", "public_two"]);
    expect(withheld(replay).map((s) => s.summary)).toEqual([
      "Hidden case 1 of 2: outcome not recorded", "Hidden case 2 of 2: outcome not recorded",
    ]);
    expect(JSON.stringify(replay)).not.toContain("secret question");
  });

  it("shows a case the problem does not list as unpublished, whatever the trace calls it", async () => {
    const id = await submitScripted(MEDIUM, mediumResult({ cases: [
      traced("public_one", "Question: the first public question", { battery: "public", status: "pass" }),
      traced("not_in_the_problem", "Question: a stray secret", { battery: "public", status: "pass" }),
    ] }));
    const replay = await replayFor(id);

    expect(shownCases(replay)).toEqual(["public_one"]);
    expect(withheld(replay)).toHaveLength(1);
    expect(withheld(replay)[0]!.battery).toBeNull();
    expect(JSON.stringify(replay)).not.toContain("stray secret");
    expect(JSON.stringify(replay)).not.toContain("not_in_the_problem");
  });
});

describe("a learner's replay of a stored trace that a Run left whole", () => {
  it("drops the unpublished cases with no row, since a Run never runs them", async () => {
    const id = await problemId(MEDIUM);
    const { rows: [attempt] } = await db().query<{ id: string }>(
      `insert into attempt (enrolment_id, problem_id, cohort_id) values ($1, $2, $3) returning id`,
      [learner.enrolmentId, id, learner.cohortId]);
    const { rows: [run] } = await db().query<{ id: string }>(
      `insert into submission (attempt_id, problem_version_id, kind, body, body_sha256, status,
                               verdict, result, finished_at)
       select $1, v.id, 'run', 'x', 'old', 'terminal', 'fail', '{}', now()
         from problem p join problem_version v on v.problem_id = p.id and v.version = p.current_version
        where p.id = $2 returning id`, [attempt!.id, id]);
    await storeTrace(db(), Number(run!.id), { cases: [
      traced("public_one", "Question: the first public question"),
      traced("hidden_two", "Question: the second secret question"),
    ] });

    const replay = await replayFor(Number(run!.id));
    expect(shownCases(replay)).toEqual(["public_one"]);
    expect(withheld(replay)).toEqual([]);
  });
});
