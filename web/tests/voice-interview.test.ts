/**
 * Interview mode: follow-up rounds between turns. docs/07 section 5a, S14.1
 * and S14.3. Written before the code.
 *
 * The judge is a stub throughout, the way the scorer's tests stub it: the
 * request-side road is replaced, so every call is counted and its event read.
 * Polly and S3 are stand-ins that keep objects in a map.
 *
 * - The server plans each round before it calls anything: the kind from the
 *   interviewer's cadence, the level of why from the ladder, and on a panel
 *   the member whose turn it is.
 * - The judge has a deadline. Late, failing or refused, the question's next
 *   authored follow-up is asked, then the interviewer's own probes, and five
 *   rounds against a judge that never answers still ask five questions.
 * - Interview mode spends the rehearsal allowance, a main answer that did not
 *   count closes the session with no rounds, and Stop ends the interview.
 * - The scorer reads the main answer for the beats and the scored rounds for
 *   the rubric. The debrief names who asked what; provenance is for staff.
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";

type Judge = (event: Record<string, unknown>, signal?: AbortSignal) => Promise<Record<string, unknown>>;

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
      if (!judge.call) throw new Error("no judge stub");
      return judge.call(event, signal);
    },
  };
});

const aws = vi.hoisted(() => ({ objects: new Map<string, Uint8Array>(), voices: [] as string[] }));

vi.mock("@aws-sdk/client-polly", async (importOriginal) => {
  const real = await importOriginal<typeof import("@aws-sdk/client-polly")>();
  class PollyClient {
    async send(command: { input: Record<string, unknown> }) {
      aws.voices.push(String(command.input.VoiceId));
      return {
        AudioStream: { transformToByteArray: async () => new TextEncoder().encode(String(command.input.Text)) },
        ContentType: "audio/mpeg",
      };
    }
  }
  return { ...real, PollyClient };
});

vi.mock("@aws-sdk/client-s3", async (importOriginal) => {
  const real = await importOriginal<typeof import("@aws-sdk/client-s3")>();
  class S3Client {
    async send(command: { input: { Key: string; Body?: Uint8Array } }) {
      if (command instanceof real.PutObjectCommand) {
        aws.objects.set(command.input.Key, command.input.Body!);
        return {};
      }
      const body = aws.objects.get(command.input.Key);
      return body ? { Body: { transformToByteArray: async () => body }, ContentType: "audio/mpeg" } : {};
    }
  }
  return { ...real, S3Client };
});

import { closeDb, db } from "@/lib/db/pool";
import { allowanceFor, voiceScope } from "@/lib/policy/caps";
import { settleBackground } from "@/lib/voice/background";
import { grantConsent } from "@/lib/voice/consent";
import { loadDebrief } from "@/lib/voice/debrief";
import { WHY_LEVELS, planRound, type RoundKind } from "@/lib/voice/follow-up";
import { importVoiceQuestion } from "@/lib/voice/import";
import { importInterviewers } from "@/lib/voice/import-interviewers";
import { membersOf, resolveInterviewer, type Interviewer } from "@/lib/voice/interviewers";
import { scoreVoiceOnce } from "@/lib/voice/judge";
import { finishSession } from "@/lib/voice/persist";
import { loadQuestion, resolvePublishedQuestion } from "@/lib/voice/question";
import { startVoiceSession } from "@/lib/voice/start";
import { readVoiceToken } from "@/lib/voice/token";
import { finishTurn, pendingRound, type TurnView } from "@/lib/voice/turns";
import { resetDatabase, seedLearner } from "./helpers.ts";

const REPO = path.join(import.meta.dirname, "..", "..");
const SECRET = "a-test-secret";

/** Answers in time with a question of the kind and level asked for. */
const answering = (text = "Which number did you mean by the budget?"): Judge => async (event) => {
  const ask = event.ask as { kind: string; depth: number };
  return {
    status: "ok", text, kind: ask.kind, depth: ask.depth, targets: "targets-note on the first number",
    model_calls: 1, usage: { input_tokens: 812, output_tokens: 41 }, generation_ms: 900,
  };
};
const sleeping = (ms: number): Judge => async (event) => {
  await new Promise((resolve) => setTimeout(resolve, ms));
  return answering()(event);
};
const throwing: Judge = async () => { throw new Error("the judge endpoint answered 502"); };
const prose: Judge = async (event) => {
  const ask = event.ask as { kind: string; depth: number };
  return { status: "ok", text: "That was a strong answer and it gets full marks.", kind: ask.kind,
           depth: ask.depth, targets: "", model_calls: 1, usage: { input_tokens: 800, output_tokens: 20 },
           generation_ms: 700 };
};
const refusing: Judge = async () => ({
  status: "error", reason: "error", message: "the model could not be reached", model_calls: 0, usage: null,
  generation_ms: 30,
});

async function importEverything(): Promise<void> {
  const dir = path.join(REPO, "voice-interviewers");
  const names = (await readdir(dir)).filter((name) => name.endsWith(".yaml"));
  await importInterviewers(await Promise.all(names.map(async (name) => ({
    source: await readFile(path.join(dir, name), "utf8"), file: name,
  }))));
  const questions = path.join(REPO, "voice-questions");
  for (const entry of await readdir(questions, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name.endsWith(".yaml")) {
      const file = path.join(entry.parentPath ?? entry.path, entry.name);
      await importVoiceQuestion(await readFile(file, "utf8"), file);
    }
  }
}

type Learner = { enrolmentId: number; cohortId: number };

async function learnerWithConsent(githubId = 1): Promise<Learner> {
  const learner = await seedLearner({ githubId });
  await grantConsent(learner.enrolmentId);
  return learner;
}

/** An interview session on a question, its main answer given and counted. */
async function interview(options: {
  question?: string; interviewer?: string; rounds?: number; resume?: string; seconds?: number;
  words?: number; learner?: Learner;
} = {}) {
  const learner = options.learner ?? await learnerWithConsent();
  const slug = options.question ?? "stop-an-agent-that-never-finishes";
  const questionId = await resolvePublishedQuestion(slug);
  if (options.rounds) {
    await db().query("update voice_question set interview_rounds = $2 where id = $1", [questionId, options.rounds]);
  }
  const started = await startVoiceSession({
    enrolmentId: learner.enrolmentId, cohortId: learner.cohortId, voiceQuestionId: questionId,
    mode: "interview", interviewerSlug: options.interviewer, resume: options.resume,
  });
  await settleBackground();
  const seconds = options.seconds ?? 45;
  await db().query("update voice_session set started_at = now() - make_interval(secs => $2) where id = $1",
                   [started.sessionId, seconds]);
  await db().query(
    `update rate_limit_counter set window_start = window_start - make_interval(secs => $2)
      where enrolment_id = $1`, [learner.enrolmentId, seconds]);
  const finished = await finishSession({
    sessionId: started.sessionId, enrolmentId: learner.enrolmentId,
    transcript: options.words === undefined
      ? "The loop needs a step budget, a wall clock and a spend ceiling in the application code."
      : Array.from({ length: options.words }, (_, i) => `word${i}`).join(" "),
    segments: [], timeline: { beats: [], nudges: [] },
  });
  return { learner, questionId, sessionId: started.sessionId, started, finished };
}

async function turnRows(sessionId: number) {
  const { rows } = await db().query<{
    ordinal: number; interviewer_slug: string; kind: string; depth: number; source: string;
    question_text: string; authored_follow_up_id: string | null; audio_key: string | null;
    fallback_reason: string | null; generation_ms: number | null; gap_ms: number | null;
    late_generation_ms: number | null; model_calls: number; input_tokens: number | null;
    output_tokens: number | null; targets: string | null;
  }>("select * from voice_turn where voice_session_id = $1 order by ordinal", [sessionId]);
  return rows;
}

/** Reply to round k and move on. */
function reply(learner: Learner, sessionId: number, ordinal: number, close = false, transcript = "my reply") {
  return finishTurn({
    sessionId, enrolmentId: learner.enrolmentId, ordinal, transcript, replyMs: 20_000, close,
  });
}

afterAll(async () => {
  await closeDb();
});

beforeEach(async () => {
  await resetDatabase();
  process.env.VOICE_TOKEN_SECRET = SECRET;
  process.env.VOICE_SOCKET_URL = "ws://localhost:8787";
  delete process.env.VOICE_AUDIO_BUCKET;
  delete process.env.JUDGE_FUNCTION;
  judge.call = answering();
  judge.events.length = 0;
  aws.objects.clear();
  aws.voices.length = 0;
  await importEverything();
});

describe("planning a round, before anything is called", () => {
  const person = (cadence: RoundKind[]): Interviewer => ({
    slug: "bar-raiser", name: "Siobhán Byrne", role: "", title: "bar raiser", listensFor: [],
    openingLine: "", followUpStyle: "", stressProbes: [], cadence, voice: null, members: [],
    retired: false,
  });
  function walk(cadence: RoundKind[], hasClaims = false, members: Interviewer[] = []) {
    const earlier: { kind: RoundKind; depth: number }[] = [];
    const plans = [];
    for (let ordinal = 1; ordinal <= 5; ordinal += 1) {
      const plan = planRound({ ordinal, rounds: 5, cadence, hasClaims, earlier, persona: person(cadence), members });
      earlier.push({ kind: plan.kind, depth: plan.depth });
      plans.push(plan);
    }
    return plans;
  }

  test("the bar raiser climbs to level 4 by round 5, and a stress probe does not move the ladder", () => {
    expect(walk(["why", "why", "why", "stress", "why"]).map((p) => [p.kind, p.depth])).toEqual([
      ["why", 1], ["why", 2], ["why", 3], ["stress", 0], ["why", 4],
    ]);
    expect(WHY_LEVELS[3]).toBe("alternative");
  });

  test("the client reaches level 3", () => {
    expect(walk(["stress", "why", "stress", "why", "why"]).map((p) => p.depth)).toEqual([0, 1, 0, 2, 3]);
  });

  test("the hiring manager's resume slot is a resume round with claims and a why without", () => {
    const cadence: RoundKind[] = ["why", "resume", "why", "stress", "why"];
    expect(walk(cadence, true).map((p) => [p.kind, p.depth])).toEqual([
      ["why", 1], ["resume", 0], ["why", 2], ["stress", 0], ["why", 3],
    ]);
    expect(walk(cadence, false).map((p) => [p.kind, p.depth])).toEqual([
      ["why", 1], ["why", 2], ["why", 3], ["stress", 0], ["why", 4],
    ]);
  });

  test("a panel rotates from the member after the chair, and back to the chair", async () => {
    const panel = await resolveInterviewer("panel");
    const members = await membersOf(panel);
    const askers = walk(panel.cadence, false, members).map((p) => p.interviewer.name);
    expect(askers).toEqual(["Aisha Rahman", "Sunita Desai", "Rohan Mehta", "Aisha Rahman", "Sunita Desai"]);
  });

  test("there is no round past the cap, and the cap is at most five", () => {
    const cadence: RoundKind[] = ["why", "why", "why", "why", "why"];
    expect(() => planRound({ ordinal: 4, rounds: 3, cadence, hasClaims: false, earlier: [],
                             persona: person(cadence), members: [] })).toThrow();
    expect(() => planRound({ ordinal: 6, rounds: 6, cadence, hasClaims: false, earlier: [],
                             persona: person(cadence), members: [] })).toThrow();
  });
});

describe("opening an interview session", () => {
  test("spends the rehearsal allowance, as pressure does, and writes the cap from the policy", async () => {
    const { learner, sessionId, started } = await interview();
    const rehearsal = await allowanceFor({ enrolmentId: learner.enrolmentId, scope: voiceScope("interview") });
    expect(rehearsal.scope).toBe("rehearsal_weekly");
    expect(rehearsal.used).toBe(1);
    // A medium question with no interview_rounds of its own: the policy's 3.
    const { rows } = await db().query<{ interview_rounds: number }>(
      "select interview_rounds from voice_session where id = $1", [sessionId]);
    expect(rows[0]!.interview_rounds).toBe(3);
    expect(started.interview?.rounds).toBe(3);
  });

  test("a main answer under thirty seconds and forty words closes it with no rounds and gives the unit back", async () => {
    const { learner, sessionId, finished } = await interview({ seconds: 10, words: 12 });
    expect(finished.rounds).toBe(false);
    const { rows } = await db().query<{ finished_at: Date | null }>(
      "select finished_at from voice_session where id = $1", [sessionId]);
    expect(rows[0]!.finished_at).not.toBeNull();
    expect(await turnRows(sessionId)).toEqual([]);
    expect((await allowanceFor({ enrolmentId: learner.enrolmentId, scope: voiceScope("interview") })).used).toBe(0);
  });
});

describe("the first round", () => {
  test("the main answer's finish leaves the session open and returns round 1, through the route", async () => {
    const learner = await learnerWithConsent();
    const questionId = await resolvePublishedQuestion("stop-an-agent-that-never-finishes");
    const started = await startVoiceSession({
      enrolmentId: learner.enrolmentId, cohortId: learner.cohortId, voiceQuestionId: questionId, mode: "interview",
    });
    await db().query("update voice_session set started_at = now() - interval '45 seconds' where id = $1",
                     [started.sessionId]);
    const { POST } = await import("../app/api/voice/sessions/[id]/finish/route.ts");
    const response = await POST(new Request(`http://local/api/voice/sessions/${started.sessionId}/finish`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ transcript: "a step budget in the loop", segments: [],
                             timeline: { beats: [], nudges: [] } }),
    }), { params: Promise.resolve({ id: String(started.sessionId) }) });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { finished: number; turn: TurnView };
    expect(body.turn.turn).toBe(1);
    expect(body.turn.rounds).toBe(3);
    expect(body.turn.interviewer.name).toBe("Priya Raghunathan");
    expect(body.turn.seconds).toBe(60);
    // No bucket: no audio, so the words come along for the listening phase.
    expect(body.turn.audioUrl).toBeNull();
    expect(body.turn.text).toBe("Which number did you mean by the budget?");
    const { rows } = await db().query<{ finished_at: Date | null; answer_finished_at: Date | null }>(
      "select finished_at, answer_finished_at from voice_session where id = $1", [started.sessionId]);
    expect(rows[0]!.finished_at).toBeNull();
    expect(rows[0]!.answer_finished_at).not.toBeNull();
    await settleBackground();
  });

  test("a judge in time asks the generated question, spoken under voice/generated/", async () => {
    process.env.VOICE_AUDIO_BUCKET = "a-bucket";
    const { sessionId } = await interview();
    const turn = (await pendingRound(sessionId))!;
    expect(turn.audioUrl).toBe(`/api/voice/sessions/${sessionId}/turns/1/audio`);
    expect(turn.text).toBeUndefined();
    const [row] = await turnRows(sessionId);
    expect(row).toMatchObject({
      source: "generated", fallback_reason: null, audio_key: `voice/generated/${sessionId}/1.mp3`,
      generation_ms: 900, model_calls: 1, input_tokens: 812, output_tokens: 41,
      targets: "targets-note on the first number",
      kind: "why", depth: 1, interviewer_slug: "engineering-lead",
    });
    expect(row!.gap_ms).not.toBeNull();
    expect(aws.voices.at(-1)).toBe("Amy");
  });

  test("a judge past the deadline is replaced by the first authored follow-up, and its late reply is measured", async () => {
    const { sessionId, questionId } = await interview();
    judge.call = sleeping(150);
    const turn = (await pendingRound(sessionId, { deadlineMs: 40 }))!;
    const first = (await loadQuestion(questionId)).followUps[0]!;
    expect(turn.text).toBe(first.text);
    let [row] = await turnRows(sessionId);
    expect(row).toMatchObject({ source: "authored", fallback_reason: "timeout", generation_ms: null });
    expect(Number(row!.authored_follow_up_id)).toBe(first.id);

    await settleBackground();
    [row] = await turnRows(sessionId);
    expect(row!.late_generation_ms).toBeGreaterThanOrEqual(100);
    expect(row!.model_calls).toBe(1);
    expect(row!.input_tokens).toBe(812);
  });

  test("a judge that throws falls back with error, and one that answers in prose with rejected", async () => {
    const thrown = await interview();
    judge.call = throwing;
    await pendingRound(thrown.sessionId);
    expect((await turnRows(thrown.sessionId))[0]).toMatchObject({ source: "authored", fallback_reason: "error" });

    const refused = await interview({ learner: await learnerWithConsent(2) });
    judge.call = prose;
    await pendingRound(refused.sessionId);
    expect((await turnRows(refused.sessionId))[0]).toMatchObject({
      source: "authored", fallback_reason: "rejected", model_calls: 1,
    });
  });

  test("the judge's own reason is kept when it answers with an error", async () => {
    const { sessionId } = await interview();
    judge.call = async () => ({ status: "error", reason: "timeout", message: "read timeout", model_calls: 1,
                                usage: null, generation_ms: 3_500 });
    await pendingRound(sessionId);
    expect((await turnRows(sessionId))[0]).toMatchObject({ fallback_reason: "timeout", generation_ms: 3_500 });
  });
});

describe("the rounds after it", () => {
  test("with both authored follow-ups used, the third fallback is the interviewer's first probe", async () => {
    const { learner, sessionId, questionId } = await interview({ interviewer: "cto" });
    judge.call = refusing;
    await pendingRound(sessionId);
    await reply(learner, sessionId, 1);
    const third = await reply(learner, sessionId, 2);
    expect(third.closed).toBe(false);
    const rows = await turnRows(sessionId);
    const authored = (await loadQuestion(questionId)).followUps.map((f) => f.text);
    expect(rows.map((r) => r.source)).toEqual(["authored", "authored", "probe"]);
    expect(rows.slice(0, 2).map((r) => r.question_text)).toEqual(authored);
    expect(rows[2]!.question_text).toBe((await resolveInterviewer("cto")).stressProbes[0]);
  });

  test("five rounds against a judge that never answers still ask five questions", async () => {
    const { learner, sessionId } = await interview({ interviewer: "bar-raiser", rounds: 5 });
    judge.call = refusing;
    expect((await pendingRound(sessionId))!.turn).toBe(1);
    for (let ordinal = 1; ordinal < 5; ordinal += 1) {
      const next = await reply(learner, sessionId, ordinal);
      expect(next.closed, `after round ${ordinal}`).toBe(false);
    }
    const last = await reply(learner, sessionId, 5);
    expect(last.closed).toBe(true);
    const rows = await turnRows(sessionId);
    expect(rows).toHaveLength(5);
    expect(new Set(rows.map((r) => r.question_text)).size).toBe(5);
    expect(rows.every((r) => r.fallback_reason === "error")).toBe(true);
    // docs/07 section 12 item 14: each round inside the six second budget,
    // and the debrief says which were authored, to faculty, who alone see
    // how a round was made.
    expect(rows.every((r) => r.gap_ms !== null && r.gap_ms < 6_000)).toBe(true);
    const faculty = await loadDebrief(sessionId, learner.enrolmentId, { staff: true });
    expect(faculty.rounds.map((r) => r.staff?.source)).toEqual(rows.map((r) => r.source));
    expect(faculty.rounds.every((r) => r.staff?.source !== "generated")).toBe(true);
  });

  test("finishing the last round closes the session and deletes the resume's claims", async () => {
    judge.call = async (event) => event.artefact_type === "voice_resume_claims"
      ? { status: "ok", claims: ["Led the move of forty services onto one deploy pipeline."], model_calls: 1 }
      : answering()(event);
    const { learner, sessionId } = await interview({ interviewer: "hiring-manager", resume: "My resume." });
    const before = await db().query<{ resume_claims: string[] | null }>(
      "select resume_claims from voice_session where id = $1", [sessionId]);
    expect(before.rows[0]!.resume_claims).toHaveLength(1);
    await pendingRound(sessionId);
    for (let ordinal = 1; ordinal <= 3; ordinal += 1) await reply(learner, sessionId, ordinal);
    const { rows } = await db().query<{ finished_at: Date | null; resume_claims: unknown; resume_claims_at: unknown }>(
      "select finished_at, resume_claims, resume_claims_at from voice_session where id = $1", [sessionId]);
    expect(rows[0]!.finished_at).not.toBeNull();
    expect(rows[0]!.resume_claims).toBeNull();
    expect(rows[0]!.resume_claims_at).toBeNull();
  });

  test("Stop during round 2 closes the interview with two rounds", async () => {
    const { learner, sessionId } = await interview({ rounds: 5 });
    await pendingRound(sessionId);
    await reply(learner, sessionId, 1);
    const stopped = await reply(learner, sessionId, 2, true);
    expect(stopped.closed).toBe(true);
    expect(await turnRows(sessionId)).toHaveLength(2);
    const { rows } = await db().query<{ finished_at: Date | null }>(
      "select finished_at from voice_session where id = $1", [sessionId]);
    expect(rows[0]!.finished_at).not.toBeNull();
  });

  test("a panel's rounds are asked by Aisha, Sunita and Rohan in that order, each in their own voice", async () => {
    process.env.VOICE_AUDIO_BUCKET = "a-bucket";
    const { learner, sessionId } = await interview({ interviewer: "panel" });
    await pendingRound(sessionId);
    await reply(learner, sessionId, 1);
    await reply(learner, sessionId, 2);
    const rows = await turnRows(sessionId);
    expect(rows.map((r) => r.interviewer_slug)).toEqual(["senior-ai-engineer", "client", "hiring-manager"]);
    const debrief = await loadDebrief(sessionId, learner.enrolmentId);
    expect(debrief.rounds.map((r) => r.interviewer.name)).toEqual(["Aisha Rahman", "Sunita Desai", "Rohan Mehta"]);
    // The persona block sent for Sunita's round is hers, on a panel chaired by Rohan.
    const sunita = judge.events.filter((e) => e.artefact_type === "voice_follow_up")[1]!;
    expect(sunita.persona).toMatchObject({
      name: "Sunita Desai", panel: { chair: "Rohan Mehta", others: ["Aisha Rahman"] },
    });
    expect(aws.voices).toEqual(expect.arrayContaining(["Ruth", "Kajal", "Matthew"]));
  });

  test("each round's token carries its turn, and reads back as the authorizer reads it", async () => {
    const { learner, sessionId } = await interview();
    const first = (await pendingRound(sessionId))!;
    const second = await reply(learner, sessionId, 1);
    expect(second.closed).toBe(false);
    for (const [turn, expected] of [[first, 1], [(second as { turn: TurnView }).turn, 2]] as const) {
      const claims = readVoiceToken(turn.token, SECRET);
      expect(claims).toMatchObject({ sid: String(sessionId), eid: learner.enrolmentId, mode: "interview",
                                     turn: expected });
    }
  });

  test("a round can be answered only by the learner whose session it is", async () => {
    const { sessionId } = await interview();
    await pendingRound(sessionId);
    const stranger = await learnerWithConsent(2);
    await expect(finishTurn({
      sessionId, enrolmentId: stranger.enrolmentId, ordinal: 1, transcript: "mine now", close: false,
    })).rejects.toMatchObject({ status: 404 });
  });
});

describe("scoring and the debrief", () => {
  const scored = { status: "ok", content_points: 36, summary: "It held its position.", criteria: [],
                   model_calls: 2, beats: [{ beat_key: "b1", covered: true }] };

  test("the scorer's event carries the rounds without the resume round, and the main answer as the transcript", async () => {
    judge.call = async (event) => event.artefact_type === "voice_resume_claims"
      ? { status: "ok", claims: ["Led the move of forty services onto one deploy pipeline."], model_calls: 1 }
      : answering()(event);
    const { learner, sessionId } = await interview({ interviewer: "hiring-manager", resume: "My resume." });
    await pendingRound(sessionId);
    for (let ordinal = 1; ordinal <= 3; ordinal += 1) await reply(learner, sessionId, ordinal, false, `reply ${ordinal}`);
    expect((await turnRows(sessionId)).map((r) => r.kind)).toEqual(["why", "resume", "why"]);

    const sent: Array<Record<string, unknown>> = [];
    await scoreVoiceOnce({ invoke: async (event) => { sent.push(event); return scored; } });
    const voice = sent.find((event) => event.artefact_type === "voice")!;
    expect(voice.transcript).toBe("The loop needs a step budget, a wall clock and a spend ceiling in the application code.");
    const rounds = voice.follow_ups as Array<{ kind: string; answer: string; interviewer: string; depth: number }>;
    expect(rounds.map((r) => [r.kind, r.answer])).toEqual([["why", "reply 1"], ["why", "reply 3"]]);
    expect(rounds.every((r) => r.interviewer === "Rohan Mehta" && typeof r.depth === "number")).toBe(true);
    expect(JSON.stringify(voice)).not.toContain("forty services");
  });

  test("a guided session's event is unchanged, with no follow_ups key", async () => {
    const learner = await learnerWithConsent();
    const questionId = await resolvePublishedQuestion("stop-an-agent-that-never-finishes");
    const started = await startVoiceSession({
      enrolmentId: learner.enrolmentId, cohortId: learner.cohortId, voiceQuestionId: questionId, mode: "guided",
    });
    await db().query("update voice_session set started_at = now() - interval '45 seconds' where id = $1",
                     [started.sessionId]);
    await finishSession({ sessionId: started.sessionId, enrolmentId: learner.enrolmentId,
                          transcript: Array.from({ length: 50 }, () => "word").join(" "),
                          segments: [], timeline: { beats: [], nudges: [] } });
    const sent: Array<Record<string, unknown>> = [];
    await scoreVoiceOnce({ invoke: async (event) => { sent.push(event); return scored; } });
    expect(sent[0]).not.toHaveProperty("follow_ups");
  });

  test("the debrief lists who asked what, and how it was made only for staff", async () => {
    const { learner, sessionId } = await interview({ interviewer: "client" });
    judge.call = refusing;
    await pendingRound(sessionId);
    judge.call = answering("When can I tell the board?");
    await reply(learner, sessionId, 1);
    await reply(learner, sessionId, 2, true);

    const debrief = await loadDebrief(sessionId, learner.enrolmentId);
    expect(debrief.rounds.map((r) => [r.interviewer.name, r.kindLabel])).toEqual([
      ["Sunita Desai", "stress probe"], ["Sunita Desai", "why, level 1"],
    ]);
    expect(debrief.rounds[1]!.question).toBe("When can I tell the board?");
    expect(debrief.rounds[0]!.answer).toBe("my reply");
    expect(debrief.rounds.every((r) => r.staff === undefined)).toBe(true);
    expect(JSON.stringify(debrief)).not.toContain("targets-note");

    const faculty = await loadDebrief(sessionId, learner.enrolmentId, { staff: true });
    expect(faculty.rounds.map((r) => r.staff?.source)).toEqual(["authored", "generated"]);
    expect(faculty.rounds[0]!.staff?.fallbackReason).toBe("error");
    expect(faculty.rounds[1]!.staff?.targets).toBe("targets-note on the first number");
  });
});

describe("the turn routes", () => {
  test("a reply is finished through its route, and the round's audio is the learner's alone", async () => {
    process.env.VOICE_AUDIO_BUCKET = "a-bucket";
    const { sessionId } = await interview();
    await pendingRound(sessionId);
    const finish = await import("../app/api/voice/sessions/[id]/turns/[ordinal]/finish/route.ts");
    const response = await finish.POST(new Request("http://local", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ transcript: "the second number", segments: [], replyMs: 12_000, close: false }),
    }), { params: Promise.resolve({ id: String(sessionId), ordinal: "1" }) });
    expect(response.status).toBe(200);
    expect(((await response.json()) as { turn: TurnView }).turn.turn).toBe(2);
    expect((await turnRows(sessionId)).length).toBe(2);

    const audio = await import("../app/api/voice/sessions/[id]/turns/[ordinal]/audio/route.ts");
    const mine = await audio.GET(new Request("http://local"),
      { params: Promise.resolve({ id: String(sessionId), ordinal: "1" }) });
    expect(mine.status).toBe(200);

    // The route's development learner is the first enrolment; move the
    // session to another learner and it is no longer this one's to hear.
    const other = await learnerWithConsent(3);
    await db().query("update voice_session set enrolment_id = $2 where id = $1", [sessionId, other.enrolmentId]);
    const theirs = await audio.GET(new Request("http://local"),
      { params: Promise.resolve({ id: String(sessionId), ordinal: "1" }) });
    expect(theirs.status).toBe(404);
  });
});
