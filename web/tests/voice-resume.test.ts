/**
 * The pasted resume. S14.2, docs/07 section 9 as amended. Written before the
 * code.
 *
 * - At most 12,000 characters, refused with a sentence past that.
 * - The text reaches the judge once and is written nowhere: no table, the
 *   audit log included, and no log line, even when the judge fails with the
 *   text in its own error.
 * - The claims reach the model only in a resume round, and are deleted when
 *   the session closes or a day after it started.
 * - Extraction has a deadline; past it the session opens without claims and
 *   says so.
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const judge = vi.hoisted(() => ({
  call: null as null | ((event: Record<string, unknown>, signal?: AbortSignal) => Promise<Record<string, unknown>>),
  events: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/voice/judge-call", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/voice/judge-call")>();
  return {
    ...real,
    callJudge: (event: Record<string, unknown>, signal?: AbortSignal) => {
      judge.events.push(event);
      return judge.call!(event, signal);
    },
  };
});

import { closeDb, db } from "@/lib/db/pool";
import { settleBackground } from "@/lib/voice/background";
import { grantConsent } from "@/lib/voice/consent";
import { importVoiceQuestion } from "@/lib/voice/import";
import { importInterviewers } from "@/lib/voice/import-interviewers";
import { finishSession } from "@/lib/voice/persist";
import { resolvePublishedQuestion } from "@/lib/voice/question";
import { RESUME_MAX_CHARS, RESUME_NOT_READ, sweepResumeClaims } from "@/lib/voice/resume";
import { startVoiceSession } from "@/lib/voice/start";
import { finishTurn, pendingRound } from "@/lib/voice/turns";
import { resetDatabase, seedLearner } from "./helpers.ts";

const REPO = path.join(import.meta.dirname, "..", "..");
/** Somewhere in the paste, and in no claim. If it is found anywhere after the
 *  session opens, the text was written. */
const SENTINEL = "Zephyrine-Quillworth-7731";
const RESUME = `Aditi Rao. ${SENTINEL}. aditi@example.com, +91 98765 43210.
Led the move of forty services onto one deploy pipeline at a payments company.
Measured a 30 percent drop in failed deploys over two quarters.`;

const CLAIMS = [
  "Led the move of forty services onto one deploy pipeline at a payments company.",
  "Measured a 30 percent drop in failed deploys over two quarters.",
  "Contact: aditi@example.com",
];

const answering = async (event: Record<string, unknown>) => {
  if (event.artefact_type === "voice_resume_claims") {
    return { status: "ok", claims: CLAIMS, model_calls: 1, usage: null, generation_ms: 400 };
  }
  const ask = event.ask as { kind: string; depth: number };
  return { status: "ok", text: "What did you decide there that someone else would not have?",
           kind: ask.kind, depth: ask.depth, targets: "the pipeline claim", model_calls: 1,
           usage: { input_tokens: 700, output_tokens: 30 }, generation_ms: 800 };
};

async function importEverything(): Promise<void> {
  const dir = path.join(REPO, "voice-interviewers");
  const names = (await readdir(dir)).filter((name) => name.endsWith(".yaml"));
  await importInterviewers(await Promise.all(names.map(async (name) => ({
    source: await readFile(path.join(dir, name), "utf8"), file: name,
  }))));
  const file = path.join(REPO, "voice-questions", "agent-loop", "stop-an-agent-that-never-finishes.yaml");
  await importVoiceQuestion(await readFile(file, "utf8"), file);
}

async function learnerWithConsent(githubId = 1) {
  const learner = await seedLearner({ githubId });
  await grantConsent(learner.enrolmentId);
  return learner;
}

function open(body: Record<string, unknown>) {
  return import("../app/api/voice/sessions/route.ts").then(({ POST }) => POST(new Request(
    "http://local/api/voice/sessions", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    })));
}

/** Every table that holds the needle anywhere in a row. */
async function tablesHolding(needle: string): Promise<string[]> {
  const { rows: tables } = await db().query<{ table_name: string }>(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'`);
  expect(tables.map((t) => t.table_name)).toContain("audit_log");
  const found: string[] = [];
  for (const { table_name } of tables) {
    const { rows } = await db().query(
      `select 1 from "${table_name}" t where t::text like $1 limit 1`, [`%${needle}%`]);
    if (rows.length) found.push(table_name);
  }
  return found;
}

async function claimsOf(sessionId: number): Promise<string[] | null> {
  const { rows } = await db().query<{ resume_claims: string[] | null }>(
    "select resume_claims from voice_session where id = $1", [sessionId]);
  return rows[0]!.resume_claims;
}

afterAll(async () => {
  await closeDb();
});

beforeEach(async () => {
  await resetDatabase();
  process.env.VOICE_TOKEN_SECRET = "a-test-secret";
  process.env.VOICE_SOCKET_URL = "ws://localhost:8787";
  delete process.env.VOICE_AUDIO_BUCKET;
  delete process.env.JUDGE_FUNCTION;
  judge.call = answering;
  judge.events.length = 0;
  await importEverything();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("pasting a resume", () => {
  test("a paste of 12,001 characters is refused with a sentence, and nothing opens", async () => {
    await learnerWithConsent();
    const response = await open({
      mode: "interview", question: "stop-an-agent-that-never-finishes",
      resume: "x".repeat(RESUME_MAX_CHARS + 1),
    });
    expect(response.status).toBe(400);
    const { message } = (await response.json()) as { message: string };
    expect(message).toMatch(/12,001 characters and the limit is 12,000/);
    expect(message).toMatch(/Nothing was started or counted\.$/);
    expect(judge.events).toEqual([]);
    const { rows } = await db().query<{ n: string }>("select count(*) as n from voice_session");
    expect(Number(rows[0]!.n)).toBe(0);
  });

  test("opening with a resume writes its claims and never its text", async () => {
    await learnerWithConsent();
    const response = await open({ mode: "interview", question: "stop-an-agent-that-never-finishes", resume: RESUME });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { sessionId: number; interview: { resumeClaims: number } };
    await settleBackground();

    // The contact line the judge returned is dropped here as well.
    expect(await claimsOf(body.sessionId)).toEqual(CLAIMS.slice(0, 2));
    expect(body.interview.resumeClaims).toBe(2);
    expect(await tablesHolding(SENTINEL)).toEqual([]);
    expect(await tablesHolding("aditi@example.com")).toEqual([]);
    // The judge saw it once, as data in its own event.
    const sent = judge.events.filter((event) => event.artefact_type === "voice_resume_claims");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toBe(RESUME.trim());
  });

  test("a failure logs a sentence without the text, even when the judge's error quotes it", async () => {
    await learnerWithConsent();
    const lines: string[] = [];
    for (const method of ["log", "warn", "error", "info"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        lines.push(args.map((arg) => (arg instanceof Error ? `${arg.message} ${arg.stack}` : String(arg))).join(" "));
      });
    }
    judge.call = async () => { throw new Error(`could not parse: ${RESUME}`); };
    const response = await open({ mode: "interview", question: "stop-an-agent-that-never-finishes", resume: RESUME });
    expect(response.status).toBe(200);
    await settleBackground();
    expect(lines.some((line) => /resume claims/.test(line))).toBe(true);
    expect(lines.join("\n")).not.toContain(SENTINEL);
    expect(await tablesHolding(SENTINEL)).toEqual([]);
  });

  test("past the deadline the session opens without claims, and says so", async () => {
    const learner = await learnerWithConsent();
    judge.call = async (event) => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      return answering(event);
    };
    const questionId = await resolvePublishedQuestion("stop-an-agent-that-never-finishes");
    const started = await startVoiceSession({
      enrolmentId: learner.enrolmentId, cohortId: learner.cohortId, voiceQuestionId: questionId,
      mode: "interview", resume: RESUME,
    }, { resumeDeadlineMs: 30 });
    expect(started.interview).toMatchObject({ resumeClaims: 0, resumeNote: RESUME_NOT_READ });
    expect(await claimsOf(started.sessionId)).toBeNull();
  });

  test("a guided session ignores a resume and never sends it", async () => {
    await learnerWithConsent();
    const response = await open({ mode: "guided", question: "stop-an-agent-that-never-finishes", resume: RESUME });
    expect(response.status).toBe(200);
    expect(judge.events).toEqual([]);
    expect(await tablesHolding(SENTINEL)).toEqual([]);
  });
});

describe("where the claims go", () => {
  async function interviewWithClaims(interviewer: string, githubId = 1) {
    const learner = await learnerWithConsent(githubId);
    const questionId = await resolvePublishedQuestion("stop-an-agent-that-never-finishes");
    const started = await startVoiceSession({
      enrolmentId: learner.enrolmentId, cohortId: learner.cohortId, voiceQuestionId: questionId,
      mode: "interview", interviewerSlug: interviewer, resume: RESUME,
    });
    await settleBackground();
    await db().query("update voice_session set started_at = now() - interval '45 seconds' where id = $1",
                     [started.sessionId]);
    await finishSession({
      sessionId: started.sessionId, enrolmentId: learner.enrolmentId,
      transcript: "The loop needs three ceilings in the application.", segments: [],
      timeline: { beats: [], nudges: [] },
    });
    return { learner, sessionId: started.sessionId };
  }

  test("a why round's event carries no claims, and a resume round's carries them", async () => {
    const { learner, sessionId } = await interviewWithClaims("hiring-manager");
    await pendingRound(sessionId);
    await finishTurn({ sessionId, enrolmentId: learner.enrolmentId, ordinal: 1, transcript: "a reply", close: false });
    const rounds = judge.events.filter((event) => event.artefact_type === "voice_follow_up");
    expect(rounds.map((event) => (event.ask as { kind: string }).kind)).toEqual(["why", "resume"]);
    expect(rounds[0]!.claims).toEqual([]);
    expect(rounds[1]!.claims).toEqual(CLAIMS.slice(0, 2));
  });

  test("closing the interview deletes them", async () => {
    const { learner, sessionId } = await interviewWithClaims("hiring-manager");
    await pendingRound(sessionId);
    await finishTurn({ sessionId, enrolmentId: learner.enrolmentId, ordinal: 1, transcript: "a reply", close: true });
    expect(await claimsOf(sessionId)).toBeNull();
  });

  test("the sweep deletes them a day after the session started, and not before", async () => {
    const old = await interviewWithClaims("hiring-manager");
    const recent = await interviewWithClaims("cto", 2);
    await db().query("update voice_session set started_at = now() - interval '25 hours' where id = $1", [old.sessionId]);
    await db().query("update voice_session set started_at = now() - interval '1 hour' where id = $1", [recent.sessionId]);
    expect(await sweepResumeClaims()).toBe(1);
    expect(await claimsOf(old.sessionId)).toBeNull();
    expect(await claimsOf(recent.sessionId)).toEqual(CLAIMS.slice(0, 2));
  });
});
