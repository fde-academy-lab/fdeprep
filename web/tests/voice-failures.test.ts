/**
 * Voice failures on the server, handled. Written before the code.
 *
 * - The voice routes rethrew anything they did not expect, so the browser got
 *   Next's HTML 500 and a fetch reading it as JSON threw instead of saying
 *   anything. They now answer JSON with a sentence that names the next action,
 *   and a signed-out request gets 401 rather than a redirect into a page a
 *   fetch cannot read.
 * - The scorer stopped for good on one session it could not read, and every
 *   answer behind it waited.
 *
 * tests/server-bundle.test.ts has the failure that started this, and
 * tests/voice-save.test.ts has the browser's side of it.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { closeDb, db } from "@/lib/db/pool";
import { allowanceFor, voiceScope } from "@/lib/policy/caps";
import { grantConsent } from "@/lib/voice/consent";
import { loadDebrief } from "@/lib/voice/debrief";
import { importVoiceQuestion } from "@/lib/voice/import";
import { scoreVoiceOnce } from "@/lib/voice/judge";
import { finishSession } from "@/lib/voice/persist";
import { resolvePublishedQuestion } from "@/lib/voice/question";
import { MAX_JUDGE_ATTEMPTS } from "@/lib/voice/score";
import { startVoiceSession } from "@/lib/voice/start";
import { resetDatabase, seedLearner } from "./helpers.ts";

const WEB = path.join(import.meta.dirname, "..");
const LOOP = path.join(WEB, "..", "voice-questions", "agent-loop",
                       "stop-an-agent-that-never-finishes.yaml");

/**
 * Switches that make one library call fail the way an outage would, so each
 * route's answer to the unexpected can be read. Off unless a test turns one
 * on, and every mock calls the real function otherwise.
 */
const outage = vi.hoisted(() => ({ start: false, finish: false, typed: false, store: false }));

vi.mock("@/lib/voice/start", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/voice/start")>();
  return {
    ...real,
    startVoiceSession: async (...args: Parameters<typeof real.startVoiceSession>) => {
      if (outage.start) throw new Error("connection terminated unexpectedly");
      return real.startVoiceSession(...args);
    },
  };
});
vi.mock("@/lib/voice/persist", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/voice/persist")>();
  return {
    ...real,
    finishSession: async (...args: Parameters<typeof real.finishSession>) => {
      if (outage.finish) throw new Error('column "input" does not exist');
      return real.finishSession(...args);
    },
  };
});
vi.mock("@/lib/voice/typed", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/voice/typed")>();
  return {
    ...real,
    submitTypedAnswer: async (...args: Parameters<typeof real.submitTypedAnswer>) => {
      if (outage.typed) throw new Error('column "input" does not exist');
      return real.submitTypedAnswer(...args);
    },
  };
});
vi.mock("@/lib/voice/audio", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/voice/audio")>();
  return {
    ...real,
    storeAudio: async (...args: Parameters<typeof real.storeAudio>) => {
      if (outage.store) throw new Error("getaddrinfo ENOTFOUND s3.us-east-1.amazonaws.com");
      return real.storeAudio(...args);
    },
  };
});

afterAll(async () => {
  await closeDb();
});

beforeEach(async () => {
  await resetDatabase();
  process.env.VOICE_TOKEN_SECRET = "a-test-secret";
  process.env.VOICE_SOCKET_URL = "ws://localhost:8787";
  delete process.env.VOICE_AUDIO_BUCKET;
});

afterEach(() => {
  Object.assign(outage, { start: false, finish: false, typed: false, store: false });
  process.env.AUTH_DEV_LEARNER = "1";
  vi.restoreAllMocks();
});

async function publish(): Promise<number> {
  await importVoiceQuestion(await readFile(LOOP, "utf8"), LOOP);
  return resolvePublishedQuestion(path.basename(LOOP, ".yaml"));
}

/** A finished answer that ran long enough to count, ready for the scorer. */
async function answered(learner: { enrolmentId: number; cohortId: number }, questionId: number) {
  const started = await startVoiceSession({
    enrolmentId: learner.enrolmentId, cohortId: learner.cohortId,
    voiceQuestionId: questionId, mode: "guided",
  });
  // Backdated as if Start was pressed 45 seconds ago: the session and the
  // allowance it claimed, which in real use share one transaction.
  await db().query(
    "update voice_session set started_at = now() - interval '45 seconds' where id = $1",
    [started.sessionId]);
  await db().query(
    `update rate_limit_counter set window_start = window_start - interval '45 seconds'
      where enrolment_id = $1`,
    [learner.enrolmentId]);
  await finishSession({
    sessionId: started.sessionId, enrolmentId: learner.enrolmentId,
    transcript: Array.from({ length: 60 }, (_, i) => `word${i}`).join(" "),
    segments: [], timeline: { beats: [], nudges: [] },
  });
  return started.sessionId;
}

function post(url: string, body: unknown): Request {
  return new Request(`http://local${url}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const params = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });

describe("the voice routes, when something unexpected fails", () => {
  test("opening a session answers JSON that names the next action", async () => {
    await seedLearner();
    await publish();
    outage.start = true;
    const { POST } = await import("../app/api/voice/sessions/route.ts");
    const response = await POST(post("/api/voice/sessions",
      { mode: "guided", question: path.basename(LOOP, ".yaml") }));
    expect(response.status).toBe(500);
    const { message } = (await response.json()) as { message: string };
    expect(message).toMatch(/try again/i);
    expect(message).toMatch(/type the answer/i);
    // The cause goes to the log. A learner can do nothing with a database
    // error, and it can carry a table name.
    expect(message).not.toMatch(/connection terminated/);
  });

  test("saving an answer answers JSON that says it did not save", async () => {
    const learner = await seedLearner();
    await grantConsent(learner.enrolmentId);
    const question = await publish();
    const started = await startVoiceSession({
      enrolmentId: learner.enrolmentId, cohortId: learner.cohortId,
      voiceQuestionId: question, mode: "guided",
    });
    outage.finish = true;
    const { POST } = await import("../app/api/voice/sessions/[id]/finish/route.ts");
    const response = await POST(post(`/api/voice/sessions/${started.sessionId}/finish`,
      { transcript: "an answer", segments: [], timeline: { beats: [], nudges: [] } }),
      params(started.sessionId));
    expect(response.status).toBe(500);
    const { message } = (await response.json()) as { message: string };
    expect(message).toMatch(/not saved/i);
    expect(message).not.toMatch(/column/);
  });

  test("a typed answer answers JSON that says it was not saved and is still in the box", async () => {
    await seedLearner();
    await publish();
    outage.typed = true;
    const { POST } = await import("../app/api/voice/sessions/typed/route.ts");
    const response = await POST(post("/api/voice/sessions/typed",
      { mode: "guided", question: path.basename(LOOP, ".yaml"), text: "An answer." }));
    expect(response.status).toBe(500);
    const { message } = (await response.json()) as { message: string };
    expect(message).toMatch(/not saved/i);
    expect(message).toMatch(/still in the box/i);
  });

  test("a recording storage cannot take is refused in JSON, and the answer is unaffected", async () => {
    const learner = await seedLearner();
    await grantConsent(learner.enrolmentId);
    const question = await publish();
    const id = await answered(learner, question);
    outage.store = true;
    const { POST } = await import("../app/api/voice/sessions/[id]/audio/route.ts");
    const response = await POST(new Request(`http://local/api/voice/sessions/${id}/audio`, {
      method: "POST", headers: { "content-type": "audio/webm" }, body: new Uint8Array([1, 2, 3]),
    }), params(id));
    expect(response.status).toBe(500);
    const { message } = (await response.json()) as { message: string };
    expect(message).toMatch(/recording was not stored/i);
    expect(message).not.toMatch(/ENOTFOUND/);
    const { rows } = await db().query<{ finished_at: Date | null }>(
      "select finished_at from voice_session where id = $1", [id]);
    expect(rows[0]!.finished_at).not.toBeNull();
  });

  test("a body that is not JSON is a 400 that says what to send, not a 500", async () => {
    await seedLearner();
    const { POST } = await import("../app/api/voice/sessions/route.ts");
    const response = await POST(post("/api/voice/sessions", "{not json"));
    expect(response.status).toBe(400);
    expect(((await response.json()) as { message: string }).message).toMatch(/pick one of/i);
  });

  test("a signed-out request gets 401 in JSON rather than a redirect a fetch cannot read", async () => {
    delete process.env.AUTH_DEV_LEARNER;
    const start = await import("../app/api/voice/sessions/route.ts");
    const typed = await import("../app/api/voice/sessions/typed/route.ts");
    const finish = await import("../app/api/voice/sessions/[id]/finish/route.ts");
    const audio = await import("../app/api/voice/sessions/[id]/audio/route.ts");
    const replies = [
      await start.POST(post("/api/voice/sessions", { mode: "guided", question: "x" })),
      await typed.POST(post("/api/voice/sessions/typed", { mode: "guided", question: "x", text: "y" })),
      await finish.POST(post("/api/voice/sessions/1/finish",
        { transcript: "", segments: [], timeline: { beats: [], nudges: [] } }), params(1)),
      await audio.POST(new Request("http://local/api/voice/sessions/1/audio", {
        method: "POST", body: new Uint8Array([1]) }), params(1)),
    ];
    for (const reply of replies) {
      expect(reply.status).toBe(401);
      expect(((await reply.json()) as { message: string }).message).toMatch(/sign in again/i);
    }
  });
});

describe("the scorer, when one session cannot be scored", () => {
  const scored = { status: "ok", content_points: 30, summary: "Clear.", criteria: [], model_calls: 2,
                   beats: [{ beat_key: "b1", covered: true }] };

  test("a reply it cannot read fails that session and the next one is still scored", async () => {
    const learner = await seedLearner();
    await grantConsent(learner.enrolmentId);
    const question = await publish();
    const first = await answered(learner, question);
    const second = await answered(learner, question);

    let calls = 0;
    const judge = async () => {
      calls += 1;
      // The first session's reply claims success in a shape the scorer
      // cannot read. It used to throw out of the loop and stop the process.
      return calls === 1 ? { status: "ok", beats: "all of them" } : scored;
    };
    await expect(scoreVoiceOnce({ invoke: judge })).resolves.toBe(2);

    const { rows } = await db().query<{ id: string; scored_at: Date | null; judge_attempts: number }>(
      "select id, scored_at, judge_attempts from voice_session order by id");
    expect(rows.find((row) => Number(row.id) === first)!.scored_at).toBeNull();
    expect(rows.find((row) => Number(row.id) === first)!.judge_attempts).toBe(1);
    expect(rows.find((row) => Number(row.id) === second)!.scored_at).not.toBeNull();
  });

  test("a session that fails every attempt that way gives its allowance back", async () => {
    const learner = await seedLearner();
    await grantConsent(learner.enrolmentId);
    const question = await publish();
    const id = await answered(learner, question);
    const unreadable = async () => ({ status: "ok", beats: "all of them" });
    for (let attempt = 0; attempt < MAX_JUDGE_ATTEMPTS; attempt += 1) {
      await scoreVoiceOnce({ invoke: unreadable });
    }
    const allowance = await allowanceFor({ enrolmentId: learner.enrolmentId, scope: voiceScope("guided") });
    expect(allowance.used).toBe(0);
    expect((await loadDebrief(id, learner.enrolmentId)).judgeGaveUp).toBe(true);
  });
});
