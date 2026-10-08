/**
 * Choosing who interviews you. S13.4, docs/07 section 2a. Written before the
 * code.
 *
 * - The browser names an interviewer by slug and the server resolves it, or
 *   takes the question's first when none was named. A slug that names
 *   nothing, or an interviewer whose file is gone, opens no session.
 * - The picker filters by interviewer and by track, and Next question keeps
 *   the same filters.
 * - The debrief and Past answers say who asked, after the file is gone too.
 * - Importing the directory twice updates in place, and an interviewer the
 *   directory dropped is retired, never deleted.
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { closeDb, db } from "@/lib/db/pool";
import { grantConsent } from "@/lib/voice/consent";
import { loadDebrief, pastSessions } from "@/lib/voice/debrief";
import { importVoiceQuestion } from "@/lib/voice/import";
import { importInterviewers } from "@/lib/voice/import-interviewers";
import {
  InterviewerNotFound, loadInterviewers, membersOf, resolveInterviewer,
} from "@/lib/voice/interviewers";
import { finishSession } from "@/lib/voice/persist";
import {
  loadQuestion, nextQuestionSlug, publishedQuestions, resolvePublishedQuestion,
} from "@/lib/voice/question";
import { startVoiceSession } from "@/lib/voice/start";
import { resetDatabase, seedLearner } from "./helpers.ts";

const REPO = path.join(import.meta.dirname, "..", "..");
const INTERVIEWERS = path.join(REPO, "voice-interviewers");
const QUESTIONS = path.join(REPO, "voice-questions");

async function interviewerFiles(): Promise<Array<{ source: string; file: string }>> {
  const names = (await readdir(INTERVIEWERS)).filter((name) => name.endsWith(".yaml")).sort();
  return Promise.all(names.map(async (name) => ({
    source: await readFile(path.join(INTERVIEWERS, name), "utf8"), file: name,
  })));
}

async function importEverything(): Promise<void> {
  await importInterviewers(await interviewerFiles());
  for (const entry of await readdir(QUESTIONS, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name.endsWith(".yaml")) {
      const file = path.join(entry.parentPath ?? entry.path, entry.name);
      await importVoiceQuestion(await readFile(file, "utf8"), file);
    }
  }
}

async function learnerWithConsent() {
  const learner = await seedLearner();
  await grantConsent(learner.enrolmentId);
  return learner;
}

async function interviewerOf(sessionId: number): Promise<string | null> {
  const { rows } = await db().query<{ interviewer_slug: string | null }>(
    "select interviewer_slug from voice_session where id = $1", [sessionId]);
  return rows[0]!.interviewer_slug;
}

afterAll(async () => {
  await closeDb();
});

beforeEach(async () => {
  await resetDatabase();
  process.env.VOICE_TOKEN_SECRET = "a-test-secret";
  process.env.VOICE_SOCKET_URL = "ws://localhost:8787";
  delete process.env.VOICE_AUDIO_BUCKET;
  await importEverything();
});

describe("resolving an interviewer", () => {
  test("a published slug resolves to its row, and an unknown one is refused", async () => {
    const cto = await resolveInterviewer("cto");
    expect(cto.name).toBe("Daniel Okafor");
    expect(cto.voice).toEqual({ id: "Brian", engine: "neural", language: "en-GB" });
    expect(cto.cadence).toEqual(["stress", "why", "why", "stress", "why"]);
    await expect(resolveInterviewer("no-such")).rejects.toBeInstanceOf(InterviewerNotFound);
  });

  test("lists the nine in their order, and seats the panel chair first", async () => {
    const all = await loadInterviewers();
    expect(all.map((i) => i.slug)).toEqual([
      "engineering-lead", "cto", "ceo", "solution-architect", "senior-ai-engineer",
      "hiring-manager", "client", "panel", "bar-raiser",
    ]);
    const members = await membersOf(await resolveInterviewer("panel"));
    expect(members.map((m) => m.name)).toEqual(["Rohan Mehta", "Aisha Rahman", "Sunita Desai"]);
  });
});

describe("the interviewer a session records", () => {
  test("is the question's first when the browser names none", async () => {
    const learner = await learnerWithConsent();
    const question = await resolvePublishedQuestion("stop-an-agent-that-never-finishes");
    expect((await loadQuestion(question)).interviewers[0]).toBe("engineering-lead");
    const started = await startVoiceSession({
      enrolmentId: learner.enrolmentId, cohortId: learner.cohortId, voiceQuestionId: question,
      mode: "guided",
    });
    expect(await interviewerOf(started.sessionId)).toBe("engineering-lead");
  });

  test("is the one the browser named, the panel included", async () => {
    const learner = await learnerWithConsent();
    const question = await resolvePublishedQuestion("stop-an-agent-that-never-finishes");
    const started = await startVoiceSession({
      enrolmentId: learner.enrolmentId, cohortId: learner.cohortId, voiceQuestionId: question,
      mode: "guided", interviewerSlug: "panel",
    });
    expect(await interviewerOf(started.sessionId)).toBe("panel");
  });

  test("a slug that names nothing opens nothing and spends nothing, through the route too", async () => {
    // The route's development learner is the first enrolment, which is this one.
    await learnerWithConsent();
    const { POST } = await import("../app/api/voice/sessions/route.ts");
    const response = await POST(new Request("http://local/api/voice/sessions", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "guided", question: "say-no-to-the-date", interviewer: "no-such" }),
    }));
    expect(response.status).toBe(404);
    expect(((await response.json()) as { message: string }).message).toMatch(/pick another interviewer/i);
    const { rows } = await db().query<{ n: string }>("select count(*) as n from voice_session");
    expect(Number(rows[0]!.n)).toBe(0);
  });
});

describe("the picker's filters", () => {
  test("an interviewer filter lists exactly the questions that interviewer asks", async () => {
    const ceo = await publishedQuestions({ interviewer: "ceo" });
    expect(ceo.map((q) => q.slug).sort()).toEqual([
      "defend-the-bolt-2-plan-to-the-sponsor", "explain-why-the-poc-number-is-58-not-81",
      "say-no-to-the-date",
    ]);
  });

  test("the two filters combine", async () => {
    const both = await publishedQuestions({ track: "agent-loop", interviewer: "bar-raiser" });
    expect(both.map((q) => q.slug)).toEqual([
      "stop-an-agent-that-never-finishes", "when-multiple-agents-make-it-worse",
    ]);
    expect(both.every((q) => q.round !== null)).toBe(true);
  });

  test("Next question stays inside the filters and wraps", async () => {
    const filters = { track: "agent-loop", interviewer: "bar-raiser" };
    expect(await nextQuestionSlug("stop-an-agent-that-never-finishes", filters))
      .toBe("when-multiple-agents-make-it-worse");
    expect(await nextQuestionSlug("when-multiple-agents-make-it-worse", filters))
      .toBe("stop-an-agent-that-never-finishes");
  });
});

describe("who asked, afterwards", () => {
  async function answered(interviewerSlug: string) {
    const learner = await learnerWithConsent();
    const question = await resolvePublishedQuestion("say-no-to-the-date");
    const started = await startVoiceSession({
      enrolmentId: learner.enrolmentId, cohortId: learner.cohortId, voiceQuestionId: question,
      mode: "guided", interviewerSlug,
    });
    await finishSession({
      sessionId: started.sessionId, enrolmentId: learner.enrolmentId, transcript: "an answer",
      segments: [], timeline: { beats: [], nudges: [] },
    });
    return { learner, sessionId: started.sessionId };
  }

  test("the debrief and Past answers name the interviewer", async () => {
    const { learner, sessionId } = await answered("ceo");
    const debrief = await loadDebrief(sessionId, learner.enrolmentId);
    expect(debrief.interviewer).toMatchObject({
      slug: "ceo", name: "Meera Krishnan", role: expect.stringMatching(/^Founder and chief executive/),
    });
    const [past] = await pastSessions(learner.enrolmentId);
    expect(past!.interviewer).toMatchObject({ slug: "ceo", name: "Meera Krishnan" });
  });

  test("a retired interviewer still names an old session and opens no new one", async () => {
    const { learner, sessionId } = await answered("ceo");
    await importInterviewers((await interviewerFiles()).filter(({ file }) => file !== "ceo.yaml"));

    expect((await loadDebrief(sessionId, learner.enrolmentId)).interviewer?.name).toBe("Meera Krishnan");
    await expect(resolveInterviewer("ceo")).rejects.toBeInstanceOf(InterviewerNotFound);
    const question = await resolvePublishedQuestion("say-no-to-the-date");
    await expect(startVoiceSession({
      enrolmentId: learner.enrolmentId, cohortId: learner.cohortId, voiceQuestionId: question,
      mode: "guided", interviewerSlug: "ceo",
    })).rejects.toBeInstanceOf(InterviewerNotFound);
    // With none named, the question's next interviewer still published asks.
    const started = await startVoiceSession({
      enrolmentId: learner.enrolmentId, cohortId: learner.cohortId, voiceQuestionId: question,
      mode: "guided",
    });
    expect(await interviewerOf(started.sessionId)).toBe("client");
  });
});

describe("importing the interviewers", () => {
  test("a second import updates in place, and a dropped file is retired, never deleted", async () => {
    const files = await interviewerFiles();
    const renamed = files.map((entry) => entry.file === "cto.yaml"
      ? { ...entry, source: entry.source.replace("name: Daniel Okafor", "name: Dan Okafor") }
      : entry);
    await importInterviewers(renamed.filter(({ file }) => file !== "bar-raiser.yaml"));

    const { rows } = await db().query<{ slug: string; name: string; retired: boolean }>(
      "select slug, name, retired_at is not null as retired from voice_interviewer order by slug");
    expect(rows).toHaveLength(9);
    expect(rows.find((r) => r.slug === "cto")!.name).toBe("Dan Okafor");
    expect(rows.find((r) => r.slug === "bar-raiser")!.retired).toBe(true);
    expect(rows.filter((r) => r.retired)).toHaveLength(1);

    // Back in the directory, back in service.
    await importInterviewers(files);
    expect((await resolveInterviewer("bar-raiser")).name).toBe("Siobhán Byrne");
  });

  test("a directory with one broken file writes nothing", async () => {
    await resetDatabase();
    const files = await interviewerFiles();
    const broken = files.map((entry) => entry.file === "client.yaml"
      ? { ...entry, source: entry.source.replace("cadence: [stress, why, stress, why, why]", "cadence: [why]") }
      : entry);
    await expect(importInterviewers(broken)).rejects.toThrow(/client\.yaml.*cadence/);
    const { rows } = await db().query<{ n: string }>("select count(*) as n from voice_interviewer");
    expect(Number(rows[0]!.n)).toBe(0);
  });
});
