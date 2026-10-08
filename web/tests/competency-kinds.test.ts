/**
 * Which kinds of submission may earn which competency state. docs/02 section
 * 7 as amended 8 October 2026, read with docs/00 section 4.
 *
 * Any finished submission with a verdict the learner earned moves a cell to
 * attempted. Only a graded kind, submit or rehearsal_submit, earns passed or
 * clean. A Run is practice, a live run carries no assertions, and a defence
 * is scored against the attempt and never the problem, so a pass on any of
 * them leaves the cell at attempted at most.
 *
 * Each case drives the real path: createSubmission writes the row and the
 * outbox, the dispatcher puts it on its lane, and writeResult commits a
 * result, which is where the cell moves.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db, inTransaction } from "../lib/db/pool.ts";
import {
  recomputeForEnrolment, stateForSubmission, type State,
} from "../lib/eval/competency.ts";
import { dispatchOnce } from "../lib/queue/dispatcher.ts";
import { writeResult } from "../lib/queue/result-writer.ts";
import { receive } from "../lib/queue/shim.ts";
import { createSubmission, type RunKind } from "../lib/submissions/create.ts";
import { importFixtures, resetDatabase, seedLearner } from "./helpers.ts";

let learner: Awaited<ReturnType<typeof seedLearner>>;

beforeEach(async () => {
  await resetDatabase();
  learner = await seedLearner();
  await importFixtures();
});

afterAll(async () => {
  await closeDb();
});

async function problem(slug: string): Promise<number> {
  const { rows } = await db().query<{ id: string }>("select id from problem where slug = $1", [slug]);
  if (!rows[0]) throw new Error(`${slug} is not imported`);
  return Number(rows[0].id);
}

async function submit(problemId: number, kind: RunKind, body = `# ${kind}`): Promise<number> {
  const created = await createSubmission({
    enrolmentId: learner.enrolmentId, cohortId: learner.cohortId, problemId, kind, body,
  });
  return created.id;
}

/** Commit a result through writeResult, from whichever lane the dispatcher used. */
async function settle(submissionId: number, result: Record<string, unknown>): Promise<void> {
  await dispatchOnce();
  const messages = [...await receive("submissions", 10), ...await receive("judgements", 10)];
  const message = messages.find((m) => Number(m.body["submission_id"]) === submissionId);
  if (!message) throw new Error(`no queue message for submission ${submissionId}`);
  expect(await writeResult({
    submission_id: submissionId,
    lease_token: String(message.body["lease_token"]),
    fencing_token: Number(message.body["fencing_token"]),
    body_sha256: String(message.body["body_sha256"]),
    result,
  })).toBe(true);
}

/** Every gate passed, inside the budget: the strongest result a code battery reports. */
function passing(llmCalls = 4): Record<string, unknown> {
  return {
    verdict: "pass", score: 100,
    gates: {
      static: { status: "pass" },
      public: { status: "pass", passed: 2, total: 2, cases: [] },
      hidden: { status: "pass", passed: 2, total: 2, cases: [] },
      adversarial: { status: "pass", passed: 1, total: 1, cases: [] },
    },
    budget: { llm_calls: llmCalls, tool_calls: 1, wall_ms: 5, max_llm_calls: 6,
              within_budget: llmCalls <= 6 },
    runner: { image_tag: "test", duration_ms: 5 },
  };
}

/** A defence the judge passed, which reports no call budget. */
const defencePassed = {
  verdict: "pass", score: 85,
  gates: {
    static: { status: "pass", checks: [] },
    probes: { status: "skipped", passed: 0, total: 0, cases: [] },
    rubric: { status: "pass", percent: 85, score: 85, criteria: [] },
  },
  model_calls: 1, consumes_allowance: true, requeue: false,
};

/** The cells of this problem's competencies at its own tier. */
async function cells(problemId: number): Promise<State[]> {
  const { rows } = await db().query<{ state: State | null }>(
    `select cs.state from problem p
       join problem_competency pc on pc.problem_id = p.id
       left join competency_score cs on cs.competency_id = pc.competency_id
        and cs.difficulty = p.difficulty and cs.enrolment_id = $2
      where p.id = $1 order by pc.competency_id`, [problemId, learner.enrolmentId]);
  expect(rows.length).toBeGreaterThan(0);
  return rows.map((row) => row.state ?? "untouched");
}

describe("the rule, in one place", () => {
  const fact = { hintsUsed: 0, llmCalls: 2, callBudget: 6 };

  it("lets a graded kind earn its state and caps every other kind at attempted", () => {
    for (const kind of ["submit", "rehearsal_submit"]) {
      expect(stateForSubmission({ kind, verdict: "pass", ...fact }), kind).toBe("clean");
      expect(stateForSubmission({ kind, verdict: "pass", ...fact, hintsUsed: 1 }), kind)
        .toBe("passed");
      expect(stateForSubmission({ kind, verdict: "fail", ...fact }), kind).toBe("attempted");
    }
    for (const kind of ["run", "live", "defence"]) {
      expect(stateForSubmission({ kind, verdict: "pass", ...fact }), kind).toBe("attempted");
      expect(stateForSubmission({ kind, verdict: "fail", ...fact }), kind).toBe("attempted");
    }
    for (const verdict of ["error", "timeout", "rejected", null]) {
      expect(stateForSubmission({ kind: "submit", verdict, ...fact }), String(verdict)).toBeNull();
    }
  });
});

describe("a pass that is not a graded submit", () => {
  it("leaves a cell at attempted after a Run passes every gate", async () => {
    const id = await problem("parse-a-tool-action");
    await settle(await submit(id, "run"), passing());
    expect(new Set(await cells(id))).toEqual(new Set(["attempted"]));
  });

  it("leaves a cell at attempted after a live run reports a pass", async () => {
    const id = await problem("parse-a-tool-action");
    await settle(await submit(id, "live"), passing());
    expect(new Set(await cells(id))).toEqual(new Set(["attempted"]));
  });

  it("never lets a defence pass raise the problem's cells", async () => {
    // A Hard pass over the call budget holds passed. The defence that follows
    // reports no call count, which read as within budget and turned the cell
    // clean before docs/02 section 7 said which kinds earn a state.
    const id = await problem("count-the-failures");
    await settle(await submit(id, "submit"), passing(9));
    expect(new Set(await cells(id))).toEqual(new Set(["passed"]));

    await settle(await submit(id, "defence", "It counts every failure once."), defencePassed);
    expect(new Set(await cells(id))).toEqual(new Set(["passed"]));
  });

  it("recomputes the same way, so a correction cannot promote a Run", async () => {
    const id = await problem("parse-a-tool-action");
    await settle(await submit(id, "run"), passing());
    await inTransaction((client) => recomputeForEnrolment(client, learner.enrolmentId));
    expect(new Set(await cells(id))).toEqual(new Set(["attempted"]));
  });
});

describe("a graded submit still earns its state", () => {
  it("earns clean after a Run passed, and keeps it", async () => {
    const id = await problem("parse-a-tool-action");
    await settle(await submit(id, "run"), passing());
    await settle(await submit(id, "submit", "# better"), passing());
    expect(new Set(await cells(id))).toEqual(new Set(["clean"]));

    await inTransaction((client) => recomputeForEnrolment(client, learner.enrolmentId));
    expect(new Set(await cells(id))).toEqual(new Set(["clean"]));
  });
});
