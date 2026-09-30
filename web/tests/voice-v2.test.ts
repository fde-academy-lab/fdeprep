/**
 * Voice interviewer v2, step 1: the fixes and the controls that make the
 * Voice Screen usable as practice rather than a demo. Written before the code.
 *
 * - The session is recorded against the question the learner chose. Before
 *   this, every graded session was recorded against the docs/07 fixture, so the
 *   judge scored the fixture's beats and the history named the wrong question.
 * - The docs/07 section 10 caps bind, and an answer abandoned inside its first
 *   thirty seconds costs nothing (section 12 item 9).
 * - A follow-up can be heard: it has an address whenever speech is configured,
 *   and the address synthesises it on first use.
 * - Re-importing content keeps a follow-up that a past interruption points at.
 * - Audio past thirty days is marked deleted, as section 9 promises.
 * - A learner whose microphone fails can type the answer, and it is scored on
 *   content and structure, with pace left out rather than invented.
 * - The debrief says where a strong answer went further: per beat, what it
 *   named that this answer never did, and the sentence it said it in. Not an
 *   evidence, number and trade-off check, which the 36 authored exemplars show
 *   cannot tell a strong answer from a weak one (lib/voice/depth.ts).
 * - A picker lists every question, and Next question moves to the one after.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { closeDb, db } from "@/lib/db/pool";
import {
  allowanceFor, RateLimitError, VOICE_FREE_SHORT_ANSWERS_PER_DAY, voiceScope,
} from "@/lib/policy/caps";
import { markExpiredAudio } from "@/lib/voice/audio";
import { grantConsent } from "@/lib/voice/consent";
import { loadDebrief } from "@/lib/voice/debrief";
import { depthByBeat } from "@/lib/voice/depth";
import { importVoiceQuestion } from "@/lib/voice/import";
import { MAX_JUDGE_ATTEMPTS, scoreVoiceOnce } from "@/lib/voice/judge";
import { finishSession } from "@/lib/voice/persist";
import {
  QuestionNotFound, loadQuestion, nextQuestionSlug, publishedQuestions, resolvePublishedQuestion,
} from "@/lib/voice/question";
import { startVoiceSession } from "@/lib/voice/start";
import { submitTypedAnswer, TypedAnswerRefused } from "@/lib/voice/typed";
import { resetDatabase, seedLearner } from "./helpers.ts";

const QUESTIONS = path.join(import.meta.dirname, "..", "..", "voice-questions");
const WEB = path.join(import.meta.dirname, "..");
const LOOP = path.join(QUESTIONS, "agent-loop", "stop-an-agent-that-never-finishes.yaml");
const DATE = path.join(QUESTIONS, "client-communication", "say-no-to-the-date.yaml");

afterAll(async () => {
  await closeDb();
});

beforeEach(async () => {
  await resetDatabase();
  process.env.VOICE_TOKEN_SECRET = "a-test-secret";
  process.env.VOICE_SOCKET_URL = "ws://localhost:8787";
  delete process.env.VOICE_AUDIO_BUCKET;
});

async function publish(file: string): Promise<number> {
  const source = await readFile(file, "utf8");
  await importVoiceQuestion(source, file);
  const slug = path.basename(file, ".yaml");
  return resolvePublishedQuestion(slug);
}

async function learnerWithConsent() {
  const learner = await seedLearner();
  await grantConsent(learner.enrolmentId);
  return learner;
}

/** A finished answer that ran for the given seconds. */
async function answered(learner: { enrolmentId: number; cohortId: number }, questionId: number,
                        mode: "guided" | "unguided" | "pressure", seconds: number, words = 60) {
  const started = await startVoiceSession({
    enrolmentId: learner.enrolmentId, cohortId: learner.cohortId, voiceQuestionId: questionId, mode,
  });
  // Backdated as if the learner had pressed Start that long ago: the session
  // and the allowance it claimed, which in real use share one transaction.
  await db().query(
    "update voice_session set started_at = now() - make_interval(secs => $2) where id = $1",
    [started.sessionId, seconds]);
  await db().query(
    `update rate_limit_counter set window_start = window_start - make_interval(secs => $2)
      where enrolment_id = $1`,
    [learner.enrolmentId, seconds]);
  await finishSession({
    sessionId: started.sessionId,
    enrolmentId: learner.enrolmentId,
    transcript: Array.from({ length: words }, (_, i) => `word${i}`).join(" "),
    segments: [],
    timeline: { beats: [], nudges: [] },
  });
  return started.sessionId;
}

describe("the question a session is recorded against", () => {
  test("is the one the learner chose, not the docs/07 fixture", async () => {
    const learner = await learnerWithConsent();
    const loop = await publish(LOOP);
    const date = await publish(DATE);
    const id = await answered(learner, date, "guided", 40);
    const { rows } = await db().query<{ voice_question_id: string }>(
      "select voice_question_id from voice_session where id = $1", [id]);
    expect(Number(rows[0]!.voice_question_id)).toBe(date);
    expect(date).not.toBe(loop);
  });

  test("an unknown or unpublished slug is refused rather than swapped for another", async () => {
    await publish(LOOP);
    await expect(resolvePublishedQuestion("no-such-question")).rejects.toBeInstanceOf(QuestionNotFound);
  });

  test("the start route takes the question from the request and resolves it on the server", async () => {
    const route = await readFile(path.join(WEB, "app", "api", "voice", "sessions", "route.ts"), "utf8");
    expect(route).not.toMatch(/fixtureQuestionId/);
    expect(route).toMatch(/resolvePublishedQuestion\(/);
  });
});

describe("the voice caps", () => {
  test("a guided session past the day's allowance is refused before any row is written", async () => {
    await db().query("update rate_limit_policy set max_count = 1 where scope = 'voice_guided_daily'");
    const learner = await learnerWithConsent();
    const question = await publish(LOOP);
    await answered(learner, question, "guided", 45);
    await expect(startVoiceSession({
      enrolmentId: learner.enrolmentId, cohortId: learner.cohortId,
      voiceQuestionId: question, mode: "guided",
    })).rejects.toBeInstanceOf(RateLimitError);
    const { rows } = await db().query<{ n: string }>("select count(*) as n from voice_session");
    expect(Number(rows[0]!.n)).toBe(1);
  });

  test("an answer abandoned inside thirty seconds and forty words costs nothing", async () => {
    await db().query("update rate_limit_policy set max_count = 1 where scope = 'voice_guided_daily'");
    const learner = await learnerWithConsent();
    const question = await publish(LOOP);
    await answered(learner, question, "guided", 12, 15);
    await expect(answered(learner, question, "guided", 45)).resolves.toBeGreaterThan(0);
  });

  test("an answer stopped at once hands the allowance straight back", async () => {
    // No backdating: the claim and the session share one transaction, so the
    // counter's window opens at the very microsecond the session starts, and
    // the release has to find that window from a timestamp that has been
    // through JavaScript's millisecond Date and back.
    const learner = await learnerWithConsent();
    const question = await publish(LOOP);
    for (const mode of ["guided", "unguided", "pressure"] as const) {
      const started = await startVoiceSession({
        enrolmentId: learner.enrolmentId, cohortId: learner.cohortId, voiceQuestionId: question, mode,
      });
      await finishSession({
        sessionId: started.sessionId, enrolmentId: learner.enrolmentId, transcript: "hello",
        segments: [], timeline: { beats: [], nudges: [] },
      });
      const allowance = await allowanceFor({ enrolmentId: learner.enrolmentId, scope: voiceScope(mode) });
      expect(allowance.used, mode).toBe(0);
    }
  });

  test("an answer that did not count is never sent to the judge", async () => {
    const learner = await learnerWithConsent();
    const question = await publish(LOOP);
    const id = await answered(learner, question, "guided", 8, 12);
    const judge = async () => { throw new Error("the judge was called on an answer that did not count"); };
    expect(await scoreVoiceOnce({ invoke: judge })).toBe(0);
    const debrief = await loadDebrief(id, learner.enrolmentId);
    expect(debrief.notCounted).toBe(true);
    expect(debrief.score).toBeNull();
  });

  test("short answers are free six times a day per mode, and the seventh counts and is scored", async () => {
    const learner = await learnerWithConsent();
    const question = await publish(LOOP);
    for (let i = 0; i < VOICE_FREE_SHORT_ANSWERS_PER_DAY; i += 1) {
      await answered(learner, question, "unguided", 5, 5);
    }
    expect((await allowanceFor({ enrolmentId: learner.enrolmentId, scope: voiceScope("unguided") })).used)
      .toBe(0);
    const seventh = await answered(learner, question, "unguided", 5, 5);
    expect((await allowanceFor({ enrolmentId: learner.enrolmentId, scope: voiceScope("unguided") })).used)
      .toBe(1);
    expect((await loadDebrief(seventh, learner.enrolmentId)).notCounted).toBe(false);
  });

  test("pressure spends the rehearsal allowance, as docs/07 section 10 says", async () => {
    await db().query("update rate_limit_policy set max_count = 1 where scope = 'rehearsal_weekly'");
    const learner = await learnerWithConsent();
    const question = await publish(LOOP);
    await answered(learner, question, "pressure", 50);
    await expect(startVoiceSession({
      enrolmentId: learner.enrolmentId, cohortId: learner.cohortId,
      voiceQuestionId: question, mode: "pressure",
    })).rejects.toBeInstanceOf(RateLimitError);
  });
});

describe("a judge that keeps failing", () => {
  test("hands the allowance back after its last attempt, and a throw counts as a failure", async () => {
    const learner = await learnerWithConsent();
    const question = await publish(LOOP);
    await answered(learner, question, "guided", 45);
    const used = async () =>
      (await allowanceFor({ enrolmentId: learner.enrolmentId, scope: voiceScope("guided") })).used;
    expect(await used()).toBe(1);

    let calls = 0;
    const failing = async () => {
      calls += 1;
      if (calls === 1) throw new Error("the judge endpoint answered 502");
      return { status: "error", message: "Bedrock throttled the request" };
    };
    for (let attempt = 0; attempt < MAX_JUDGE_ATTEMPTS; attempt += 1) {
      expect(await scoreVoiceOnce({ invoke: failing })).toBe(1);
    }
    expect(calls).toBe(MAX_JUDGE_ATTEMPTS);
    expect(await used()).toBe(0);
    // Nothing is left for the scorer to retry, and the debrief says so.
    expect(await scoreVoiceOnce({ invoke: failing })).toBe(0);
    const { rows } = await db().query<{ id: string }>("select id from voice_session");
    expect((await loadDebrief(Number(rows[0]!.id), learner.enrolmentId)).judgeGaveUp).toBe(true);
  });
});

describe("follow-up audio", () => {
  test("has an address whenever speech is configured, before it was ever synthesised", async () => {
    process.env.VOICE_AUDIO_BUCKET = "a-bucket";
    const question = await loadQuestion(await publish(LOOP));
    expect(question.followUps.length).toBeGreaterThan(0);
    for (const followUp of question.followUps) expect(followUp.audioUrl).toMatch(/\/audio$/);
  });

  test("has none where speech is not configured, so the line is shown instead", async () => {
    const question = await loadQuestion(await publish(LOOP));
    for (const followUp of question.followUps) expect(followUp.audioUrl).toBeNull();
  });
});

describe("re-importing voice content", () => {
  async function interrupted() {
    const learner = await learnerWithConsent();
    const questionId = await publish(LOOP);
    const question = await loadQuestion(questionId);
    const started = await startVoiceSession({
      enrolmentId: learner.enrolmentId, cohortId: learner.cohortId,
      voiceQuestionId: questionId, mode: "pressure",
    });
    const followUp = question.followUps[0]!;
    await finishSession({
      sessionId: started.sessionId, enrolmentId: learner.enrolmentId, transcript: "an answer",
      segments: [], timeline: { beats: [], nudges: [],
        interruptions: [{ followUpId: followUp.id, firedAtMs: 20_000, endedAtMs: 50_000 }] },
    });
    await db().query("update voice_follow_up set audio_key = 'voice/follow-ups/cached.mp3' where id = $1",
                     [followUp.id]);
    return { questionId, followUp };
  }

  test("keeps a follow-up an interruption points at, and its cached audio", async () => {
    const { followUp } = await interrupted();
    await expect(publish(LOOP)).resolves.toBeGreaterThan(0);
    const { rows } = await db().query<{ audio_key: string | null }>(
      "select audio_key from voice_follow_up where id = $1", [followUp.id]);
    expect(rows[0]!.audio_key).toBe("voice/follow-ups/cached.mp3");
  });

  test("retires a follow-up the file no longer has, and stops serving it", async () => {
    const { questionId } = await interrupted();
    const source = await readFile(LOOP, "utf8");
    const trimmed = source.replace(/\n  - trigger_after_beat: b3\n    text: [^\n]+/, "");
    expect(trimmed).not.toBe(source);
    await importVoiceQuestion(trimmed, LOOP);
    const question = await loadQuestion(questionId);
    expect(question.followUps).toHaveLength(1);
    const { rows } = await db().query<{ n: string }>(
      "select count(*) as n from voice_follow_up where voice_question_id = $1 and retired_at is not null",
      [questionId]);
    expect(Number(rows[0]!.n)).toBe(1);
  });

  test("a follow-up whose words change loses its cached audio", async () => {
    const { followUp } = await interrupted();
    const source = await readFile(LOOP, "utf8");
    expect(source).toContain(followUp.text);
    await importVoiceQuestion(source.replace(followUp.text, `${followUp.text} Say why.`), LOOP);
    const { rows } = await db().query<{ audio_key: string | null }>(
      "select audio_key from voice_follow_up where id = $1", [followUp.id]);
    expect(rows[0]!.audio_key).toBeNull();
  });
});

describe("audio retention", () => {
  test("audio past thirty days is marked deleted, and newer audio is left alone", async () => {
    const learner = await learnerWithConsent();
    const question = await publish(LOOP);
    const old = await answered(learner, question, "guided", 40);
    const recent = await answered(learner, question, "unguided", 40);
    await db().query(
      `update voice_session set audio_s3_key = 'voice/answers/' || id || '.webm',
              finished_at = case when id = $1 then now() - interval '31 days' else finished_at end`, [old]);
    expect(await markExpiredAudio()).toBe(1);
    const { rows } = await db().query<{ id: string; gone: boolean }>(
      "select id, audio_deleted_at is not null as gone from voice_session order by id");
    expect(rows.map((r) => [Number(r.id), r.gone])).toEqual([[old, true], [recent, false]]);
  });
});

describe("a typed answer", () => {
  function scriptedJudge() {
    return async () => ({
      status: "ok", content_points: 30, content_out_of: 50, criteria: [],
      beats: ["b1", "b2", "b3", "b4", "b5"].map((key, i) => ({
        beat_key: key, covered: i < 3, evidence_quote: "a budget" })),
      summary: "It named the budget and never said what the user sees.", model_calls: 2,
    });
  }

  test("is saved as a finished session marked typed and scored on content and structure", async () => {
    const learner = await learnerWithConsent();
    const question = await publish(LOOP);
    const id = await submitTypedAnswer({
      enrolmentId: learner.enrolmentId, cohortId: learner.cohortId, voiceQuestionId: question,
      mode: "guided",
      text: "The loop needs a step budget. When it runs out we return a message the user can act " +
            "on, and we log the run so an engineer can see why it never finished.",
    });
    expect(await scoreVoiceOnce({ invoke: scriptedJudge() })).toBe(1);
    const debrief = await loadDebrief(id, learner.enrolmentId);
    expect(debrief.input).toBe("typed");
    expect(debrief.score!.pace).toBeNull();
    expect(debrief.score!.structure).toBeCloseTo(30 * 3 / 5, 5);
    expect(debrief.score!.total).toBe(Math.round((30 + 18) / 80 * 100 * 100) / 100);
  });

  test("an empty answer is refused and writes nothing", async () => {
    const learner = await learnerWithConsent();
    const question = await publish(LOOP);
    await expect(submitTypedAnswer({
      enrolmentId: learner.enrolmentId, cohortId: learner.cohortId, voiceQuestionId: question,
      mode: "guided", text: "   " })).rejects.toBeInstanceOf(TypedAnswerRefused);
    const { rows } = await db().query<{ n: string }>("select count(*) as n from voice_session");
    expect(Number(rows[0]!.n)).toBe(0);
  });
});

describe("where a strong answer went further", () => {
  test("names, per beat, what a strong answer said that this one never did", () => {
    const depth = depthByBeat(
      [{ key: "b1", anchors: ["killing the pod", "no answer"] },
       { key: "b2", anchors: ["steps", "wall clock", "spend"] }],
      "We cap the steps and the spend.",
      "Killing the pod left the customer with no answer. We cap steps, wall clock and spend.");
    expect(depth.map((beat) => [beat.key, beat.named, beat.missing])).toEqual([
      ["b1", [], ["killing the pod", "no answer"]],
      ["b2", ["steps", "spend"], ["wall clock"]],
    ]);
    expect(depth.map((beat) => beat.strongLine)).toEqual([
      "Killing the pod left the customer with no answer.",
      "We cap steps, wall clock and spend.",
    ]);
  });

  test("quotes nothing where the strong answer names none of the beat's words", () => {
    const [beat] = depthByBeat([{ key: "b1", anchors: ["a ceiling"] }], "", "Nothing relevant here.");
    expect(beat!.strongLine).toBeNull();
  });

  test("reaches the debrief, with the question's own strong exemplar", async () => {
    const learner = await learnerWithConsent();
    const question = await publish(LOOP);
    const id = await submitTypedAnswer({
      enrolmentId: learner.enrolmentId, cohortId: learner.cohortId, voiceQuestionId: question,
      mode: "unguided",
      text: "Killing the pod left no answer. The limits live in the application, not in the " +
            "prompt: steps and spend.",
    });
    const debrief = await loadDebrief(id, learner.enrolmentId);
    const b2 = debrief.depth.find((beat) => beat.key === "b2")!;
    expect(b2.missing).toEqual(["wall clock"]);
    expect(b2.strongLine).toMatch(/in the application rather than in the prompt/);
  });
});

describe("the picker and the next question", () => {
  test("lists every published question by track, with its difficulty and clock", async () => {
    await publish(LOOP);
    await publish(DATE);
    const listed = await publishedQuestions();
    // By track in docs/07 section 11's order, so agent-loop comes before
    // client-communication whatever the slugs say.
    expect(listed.map((q) => q.slug)).toEqual(["stop-an-agent-that-never-finishes", "say-no-to-the-date"]);
    for (const q of listed) {
      expect(q.track).toBeTruthy();
      expect(q.difficulty).toBeTruthy();
      expect(q.totalSeconds).toBeGreaterThan(60);
    }
  });

  test("moves to the next question in the picker's order and wraps at the end", async () => {
    await publish(LOOP);
    await publish(DATE);
    const order = (await publishedQuestions()).map((q) => q.slug);
    expect(await nextQuestionSlug(order[0]!)).toBe(order[1]);
    expect(await nextQuestionSlug(order[1]!)).toBe(order[0]);
  });
});

describe("the cockpit", () => {
  const source = () => readFile(path.join(WEB, "app", "(focus)", "voice", "session", "cockpit.tsx"), "utf8");

  test("opens the session on the question on screen", async () => {
    expect(await source()).toMatch(/JSON\.stringify\(\{ mode, question: question\.slug \}\)/);
  });

  test("waits for the socket to hand back its last words before saving", async () => {
    const text = await source();
    expect(text).toMatch(/message\.t === "closed"/);
    expect(text).toMatch(/transcript\.current\.partial/);
  });

  test("keeps the typed answer out of the cockpit, where no text may render", async () => {
    expect(await source()).not.toMatch(/<textarea/);
    const typed = await readFile(path.join(WEB, "app", "(focus)", "voice", "session", "typed-answer.tsx"), "utf8");
    expect(typed).toMatch(/<textarea/);
  });
});
