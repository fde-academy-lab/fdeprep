/**
 * Who may open whose record, story S15.13. Written before the fix.
 *
 * Reported on 8 October 2026: the submission view and its event stream
 * answered anyone holding a cookie named fdeprep_session, whatever its value,
 * and the proxy checked only that such a cookie existed. Counting through ids
 * read every learner's results, which after a pass carry the hidden and
 * adversarial case names and, on a prompt problem, the probe messages.
 *
 * The rule, docs/00 section 2 with the cohort as the boundary: a learner opens
 * their own work, faculty open their own cohort's, and an admin opens any
 * cohort's. A record somebody may not open answers exactly as a number nobody
 * holds, so the answer confirms nothing.
 *
 * Every request here carries a cookie, signed or forged, and goes through the
 * real verification in lib/session/current.ts. The only thing mocked about the
 * session is where the cookie comes from.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ cookie: undefined as string | undefined }));
const aws = vi.hoisted(() => ({ objects: new Map<string, Uint8Array>() }));

vi.mock("next/headers", async (original) => ({
  ...(await original<typeof import("next/headers")>()),
  // What a browser sends, and nothing else: the cookie, read by name.
  cookies: async () => ({
    get: (name: string) => (jar.cookie === undefined ? undefined : { name, value: jar.cookie }),
  }),
}));

// The debrief's recording controls ask for the router. Nothing here navigates.
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));

vi.mock("@aws-sdk/client-s3", async (importOriginal) => {
  const real = await importOriginal<typeof import("@aws-sdk/client-s3")>();
  class S3Client {
    async send(command: { input: { Key: string } }) {
      if (command instanceof real.GetObjectCommand) {
        const body = aws.objects.get(command.input.Key);
        return body ? { Body: { transformToByteArray: async () => body }, ContentType: "audio/webm" } : {};
      }
      if (command instanceof real.DeleteObjectCommand) aws.objects.delete(command.input.Key);
      return {};
    }
  }
  return { ...real, S3Client };
});

import { mintSession, SESSION_TTL_S } from "../lib/auth/session.ts";
import { closeDb, db } from "../lib/db/pool.ts";
import type { Evaluation } from "../lib/eval/consolidate.ts";
import { saveEvaluation } from "../lib/eval/record.ts";
import { mayRead } from "../lib/session/records.ts";
import { importVoiceQuestion } from "../lib/voice/import.ts";
import * as submissionRoute from "../app/api/submissions/[id]/route.ts";
import * as eventsRoute from "../app/api/submissions/[id]/events/route.ts";
import * as audioRoute from "../app/api/voice/sessions/[id]/audio/route.ts";
import * as shareRoute from "../app/api/voice/sessions/[id]/share/route.ts";
import * as finishRoute from "../app/api/voice/sessions/[id]/finish/route.ts";
import * as turnAudioRoute from "../app/api/voice/sessions/[id]/turns/[ordinal]/audio/route.ts";
import * as overrideRoute from "../app/api/admin/evaluations/[id]/override/route.ts";
import * as reviewRoute from "../app/api/admin/evaluations/[id]/review/route.ts";
import TracePage from "../app/(shell)/traces/[id]/page.tsx";
import DebriefPage from "../app/(shell)/voice/sessions/[id]/page.tsx";
import SubmissionRecordPage from "../app/(shell)/admin/submissions/[id]/page.tsx";
import SubmissionsPage from "../app/(shell)/admin/submissions/page.tsx";
import DisagreementsPage from "../app/(shell)/admin/disagreements/page.tsx";
import { importFixtures, resetDatabase, seedLearner } from "./helpers.ts";

const SECRET = "record-access-signing-secret";
const NOT_FOUND = { digest: "NEXT_HTTP_ERROR_FALLBACK;404" };
const TO_SIGN_IN = { digest: expect.stringMatching(/^NEXT_REDIRECT;\w+;\/signin;307;$/) };

/** An id nobody holds, so its answer is what "does not exist" looks like. */
const MISSING = 987_654;
/** What a passed submission's view carries and nobody else may read. */
const HIDDEN_CASE = "hidden_case_that_only_its_owner_has_earned";
const TRANSCRIPT = "The loop stops at the step budget and says why it stopped.";
const RECORDING = new Uint8Array([7, 7, 7, 7]);

const VOICE = path.join(import.meta.dirname, "..", "..", "voice-questions");
const QUESTION = "agent-loop/stop-an-agent-that-never-finishes.yaml";

type Seeded = { enrolmentId: number; cohortId: number; userId: number };

let owner: Seeded;          // Bea, a learner in cohort 3, whose work this is
let classmate: Seeded;      // Abe, a learner in the same cohort
let faculty: Seeded;        // Fay, faculty of cohort 3
let otherFaculty: Seeded;   // Fin, faculty of cohort 4
let admin: Seeded;          // Ada, an admin enrolled in cohort 4
let submissionId = 0;
let sessionId = 0;
let evaluationId = 0;

const saved = {
  secret: process.env.AUTH_SECRET,
  dev: process.env.AUTH_DEV_LEARNER,
  bucket: process.env.VOICE_AUDIO_BUCKET,
};

const request = (url: string, init?: RequestInit) => new Request(`http://localhost${url}`, init);
const params = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });
const post = (url: string, body: unknown) => request(url, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});
const html = async (page: ReactElement | Promise<ReactElement>) => renderToStaticMarkup(await page);
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/&#x27;|&apos;/g, "'")
  .replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

/**
 * Everything a caller can observe about an answer. The id asked for is taken
 * out of the body, because an answer that repeats the number it was given
 * says nothing about whether the number is in use.
 */
async function observed(response: Response, asked?: number) {
  const body = await response.text();
  return {
    status: response.status,
    type: response.headers.get("content-type"),
    body: asked === undefined ? body : body.replaceAll(String(asked), "<id>"),
  };
}

function signIn(who: Seeded | null): void {
  jar.cookie = who ? mintSession({ uid: who.userId }, SECRET) : undefined;
}

/**
 * The cookies an attacker can make without the secret. The first is the
 * report itself: any value at all under the right name.
 */
function forgeries(): Array<[string, string]> {
  const genuine = mintSession({ uid: owner.userId }, SECRET);
  const [, signature] = genuine.split(".");
  const claim = Buffer.from(JSON.stringify({ uid: owner.userId, exp: 9_999_999_999 }))
    .toString("base64url");
  const longAgo = Math.floor(Date.now() / 1000) - SESSION_TTL_S - 60;
  return [
    ["any value at all", "anything"],
    ["a claim to be the owner, carrying another cookie's signature", `${claim}.${signature}`],
    ["the owner's id signed with another secret", mintSession({ uid: owner.userId }, "not-the-secret")],
    ["the owner's own cookie after it expired", mintSession({ uid: owner.userId }, SECRET, longAgo)],
  ];
}

const reads = {
  submission: (id: number) => submissionRoute.GET(request(`/api/submissions/${id}`), params(id)),
  events: (id: number) => eventsRoute.GET(request(`/api/submissions/${id}/events`), params(id)),
  audio: (id: number) => audioRoute.GET(request(`/api/voice/sessions/${id}/audio`), params(id)),
  turnAudio: (id: number) => turnAudioRoute.GET(request(`/api/voice/sessions/${id}/turns/1/audio`),
    { params: Promise.resolve({ id: String(id), ordinal: "1" }) }),
};

const writes = {
  storeAudio: (id: number) => audioRoute.POST(request(`/api/voice/sessions/${id}/audio`, {
    method: "POST", headers: { "content-type": "audio/webm" }, body: new Uint8Array([1, 2, 3]),
  }), params(id)),
  deleteAudio: (id: number) => audioRoute.DELETE(
    request(`/api/voice/sessions/${id}/audio`, { method: "DELETE" }), params(id)),
  share: (id: number) => shareRoute.POST(post(`/api/voice/sessions/${id}/share`, { shared: true }), params(id)),
  finish: (id: number) => finishRoute.POST(post(`/api/voice/sessions/${id}/finish`,
    { transcript: "", segments: [], timeline: { beats: [], nudges: [] } }), params(id)),
};

const staffActions = {
  review: (id: number) => reviewRoute.POST(post(`/api/admin/evaluations/${id}/review`,
    { disposition: "upheld", note: "The held band matches the answer." }), params(id)),
  override: (id: number) => overrideRoute.POST(post(`/api/admin/evaluations/${id}/override`,
    { band: "adequate", note: "The answer names the stop condition the rubric asks for." }), params(id)),
};

async function setShared(shared: boolean): Promise<void> {
  if (shared) {
    await db().query(
      `insert into voice_session_share (voice_session_id) values ($1)
       on conflict (voice_session_id) do update set withdrawn_at = null`, [sessionId]);
  } else {
    await db().query("delete from voice_session_share where voice_session_id = $1", [sessionId]);
  }
}

beforeAll(async () => {
  process.env.AUTH_SECRET = SECRET;
  // vitest.config.ts signs every cookie-less call in as the development
  // learner. These tests are about who is asking, so nobody is signed in
  // unless a cookie says so.
  delete process.env.AUTH_DEV_LEARNER;
  process.env.VOICE_AUDIO_BUCKET = "record-access-bucket";

  await resetDatabase();
  await importFixtures();
  owner = await seedLearner({ githubId: 101, login: "bea-owner" });
  classmate = await seedLearner({ githubId: 102, login: "abe-classmate", cohortId: owner.cohortId });
  faculty = await seedLearner({ githubId: 103, login: "fay-faculty", cohortId: owner.cohortId });
  const { rows: [elsewhere] } = await db().query<{ id: string }>(
    "insert into cohort (slug, name, starts_on) values ('c4', 'Cohort 4', current_date) returning id");
  otherFaculty = await seedLearner({ githubId: 104, login: "fin-faculty", cohortId: Number(elsewhere!.id) });
  admin = await seedLearner({ githubId: 105, login: "ada-admin", cohortId: Number(elsewhere!.id) });
  await db().query("update enrolment set role = 'faculty' where id = any($1::bigint[])",
    [[faculty.enrolmentId, otherFaculty.enrolmentId]]);
  await db().query("update enrolment set role = 'admin' where id = $1", [admin.enrolmentId]);

  // The owner passed this problem, so the view of their submission names the
  // hidden case. That is what the reported hole handed to anyone counting.
  const { rows: [problem] } = await db().query<{ id: string; version_id: string }>(
    `select p.id, v.id as version_id from problem p
       join problem_version v on v.problem_id = p.id and v.version = p.current_version
      where p.slug = 'echo-the-question'`);
  const { rows: [attempt] } = await db().query<{ id: string }>(
    `insert into attempt (enrolment_id, problem_id, cohort_id, solved_at)
     values ($1, $2, $3, now()) returning id`, [owner.enrolmentId, problem!.id, owner.cohortId]);
  const result = {
    gates: {
      static: { status: "pass", passed: 1, total: 1, cases: [] },
      public: { status: "pass", passed: 1, total: 1,
                cases: [{ name: "public_case", status: "pass", message: null }] },
      hidden: { status: "pass", passed: 1, total: 1,
                cases: [{ name: HIDDEN_CASE, status: "pass", message: null }] },
      adversarial: { status: "skipped", passed: 0, total: 0, cases: [] },
    },
  };
  const { rows: [submission] } = await db().query<{ id: string }>(
    `insert into submission (attempt_id, problem_version_id, kind, body, body_sha256, status,
                             verdict, score, finished_at, result)
     values ($1, $2, 'submit', 'def run_agent(question, llm, tools): return question',
             'record-access-1', 'terminal', 'pass', 100, now(), $3)
     returning id`, [attempt!.id, problem!.version_id, JSON.stringify(result)]);
  submissionId = Number(submission!.id);

  // A grade the panel argued over, so the review and the override have
  // something to act on.
  const evaluation: Evaluation = {
    submissionId, complexity: "C4", state: "complete", verdict: "pass", score: 40,
    scoreProvisional: false, confidence: "low", band: "weak",
    panel: [
      { panelist: "static", status: "ran", ms: 3, findings: [], verdict: "pass", scoreContribution: 40 },
      { panelist: "pretrained", status: "ran", ms: 180, findings: [], band: "weak" },
      { panelist: "llm", status: "ran", ms: 900, findings: [], band: "strong" },
    ],
    disagreement: { bands: ["weak", "strong"], held: "weak" },
    feedbackMd: "One voice.",
  };
  evaluationId = await saveEvaluation(evaluation, owner.enrolmentId, db());

  // The owner's spoken answer, finished, with its recording in the bucket.
  await importVoiceQuestion(await readFile(path.join(VOICE, QUESTION), "utf8"), QUESTION);
  const { rows: [question] } = await db().query<{ id: string }>("select id from voice_question limit 1");
  const { rows: [voice] } = await db().query<{ id: string }>(
    `insert into voice_session (enrolment_id, voice_question_id, cohort_id, mode, started_at,
                                finished_at, transcript, audio_s3_key)
     values ($1, $2, $3, 'guided', now() - interval '3 minutes', now() - interval '1 minute',
             $4, 'voice/answers/record-access.webm')
     returning id`, [owner.enrolmentId, question!.id, owner.cohortId, TRANSCRIPT]);
  sessionId = Number(voice!.id);
  aws.objects.set("voice/answers/record-access.webm", RECORDING);
}, 120_000);

afterAll(async () => {
  for (const [name, value] of [["AUTH_SECRET", saved.secret], ["AUTH_DEV_LEARNER", saved.dev],
                               ["VOICE_AUDIO_BUCKET", saved.bucket]] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  jar.cookie = undefined;
  await closeDb();
});

describe("the rule, on its own", () => {
  const owned = { enrolmentId: 1, cohortId: 3 };

  it("lets the owner, faculty of the cohort and any admin read, and nobody else", () => {
    expect(mayRead({ enrolmentId: 1, cohortId: 3, role: "learner" }, owned)).toBe(true);
    expect(mayRead({ enrolmentId: 2, cohortId: 3, role: "learner" }, owned)).toBe(false);
    expect(mayRead({ enrolmentId: 3, cohortId: 3, role: "faculty" }, owned)).toBe(true);
    expect(mayRead({ enrolmentId: 4, cohortId: 4, role: "faculty" }, owned)).toBe(false);
    expect(mayRead({ enrolmentId: 5, cohortId: 4, role: "admin" }, owned)).toBe(true);
  });
});

describe("a forged cookie gets what no cookie gets", () => {
  // Each route asked about the owner's own record, the one a forger wants.
  const routes: Array<[string, () => Promise<Response>]> = [
    ...Object.entries(reads).map(([name, call]): [string, () => Promise<Response>] =>
      [name, () => call(name === "submission" || name === "events" ? submissionId : sessionId)]),
    ...Object.entries(writes).map(([name, call]): [string, () => Promise<Response>] =>
      [name, () => call(sessionId)]),
    ...Object.entries(staffActions).map(([name, call]): [string, () => Promise<Response>] =>
      [name, () => call(evaluationId)]),
  ];

  for (const [name, call] of routes) {
    it(`on ${name}`, async () => {
      signIn(null);
      const signedOut = await observed(await call());
      expect(signedOut.status).toBe(401);
      expect(JSON.parse(signedOut.body).message).toMatch(/sign in again/i);

      for (const [forgery, cookie] of forgeries()) {
        jar.cookie = cookie;
        expect(await observed(await call()), forgery).toEqual(signedOut);
      }
    });
  }

  it("on the trace, the debrief and the submission record, which send it to sign in", async () => {
    const pages = [
      () => TracePage(params(submissionId)),
      () => DebriefPage(params(sessionId)),
      () => SubmissionRecordPage(params(submissionId)),
    ];
    for (const page of pages) {
      signIn(null);
      await expect(page()).rejects.toMatchObject(TO_SIGN_IN);
      for (const [forgery, cookie] of forgeries()) {
        jar.cookie = cookie;
        await expect(page(), forgery).rejects.toMatchObject(TO_SIGN_IN);
      }
    }
  });
});

describe("a learner asking for another learner's work", () => {
  it("gets the answer a number nobody holds gets, for every route and every page", async () => {
    signIn(classmate);
    await setShared(true);
    const ids: Record<string, [number, number]> = {
      submission: [submissionId, MISSING], events: [submissionId, MISSING],
      audio: [sessionId, MISSING], turnAudio: [sessionId, MISSING],
      storeAudio: [sessionId, MISSING], deleteAudio: [sessionId, MISSING],
      share: [sessionId, MISSING], finish: [sessionId, MISSING],
    };
    for (const [name, call] of Object.entries({ ...reads, ...writes })) {
      const [theirs, nobodys] = ids[name]!;
      const answer = await observed(await call(theirs));
      expect(answer.status, name).toBe(404);
      expect(answer, name).toEqual(await observed(await call(nobodys)));
      expect(answer.body, name).not.toContain(HIDDEN_CASE);
    }

    await expect(TracePage(params(submissionId))).rejects.toMatchObject(NOT_FOUND);
    await expect(DebriefPage(params(sessionId))).rejects.toMatchObject(NOT_FOUND);
    await expect(SubmissionRecordPage(params(submissionId))).rejects.toMatchObject(NOT_FOUND);
  });

  it("changes nothing on the owner's answer by asking", async () => {
    signIn(classmate);
    await setShared(false);
    for (const call of Object.values(writes)) await call(sessionId);
    const { rows: [row] } = await db().query<{ key: string | null; finished: Date | null; shares: string }>(
      `select audio_s3_key as key, finished_at as finished,
              (select count(*) from voice_session_share where voice_session_id = s.id) as shares
         from voice_session s where s.id = $1`, [sessionId]);
    expect(row).toMatchObject({ key: "voice/answers/record-access.webm", shares: "0" });
    expect(aws.objects.has("voice/answers/record-access.webm")).toBe(true);
  });
});

describe("faculty of the owner's cohort", () => {
  it("read the submission, its event stream, its trace and its evaluations", async () => {
    signIn(faculty);
    const view = await reads.submission(submissionId);
    expect(view.status).toBe(200);
    expect((await view.json()).id).toBe(submissionId);

    const stream = await reads.events(submissionId);
    expect(stream.status).toBe(200);
    expect(stream.headers.get("content-type")).toMatch(/^text\/event-stream/);
    expect(await stream.text()).toContain(`"id":${submissionId}`);

    expect(text(await html(TracePage(params(submissionId))))).toContain("Trace replay");
    expect(text(await html(SubmissionRecordPage(params(submissionId))))).toContain(`Submission ${submissionId}`);
  });

  it("read the debrief's transcript and score without the owner's controls", async () => {
    signIn(faculty);
    await setShared(false);
    const page = await html(DebriefPage(params(sessionId)));
    expect(text(page)).toContain(TRANSCRIPT);
    expect(text(page)).not.toContain("Let faculty hear this one session.");
    expect(text(page)).not.toContain("Delete this recording");
    expect(text(page)).not.toContain("Answer it again");
    expect(page).not.toContain(`/api/voice/sessions/${sessionId}/audio`);
  });

  it("hear the recording only once the learner shares it (docs/07 section 9)", async () => {
    signIn(faculty);
    await setShared(false);
    const unshared = await reads.audio(sessionId);
    expect(unshared.status).toBe(403);
    expect((await unshared.json()).message).toMatch(/not been shared/);

    await setShared(true);
    const shared = await reads.audio(sessionId);
    expect(shared.status).toBe(200);
    expect(new Uint8Array(await shared.arrayBuffer())).toEqual(RECORDING);
    expect(await html(DebriefPage(params(sessionId)))).toContain(`/api/voice/sessions/${sessionId}/audio`);
  });

  it("cannot change the learner's answer, which is the learner's alone", async () => {
    signIn(faculty);
    for (const [name, call] of Object.entries(writes)) {
      expect(await observed(await call(sessionId)), name).toEqual(await observed(await call(MISSING)));
    }
    expect(aws.objects.has("voice/answers/record-access.webm")).toBe(true);
  });

  it("find the learner's rows on Submissions and on Disagreements", async () => {
    signIn(faculty);
    expect(text(await html(SubmissionsPage({ searchParams: Promise.resolve({}) })))).toContain("bea-owner");
    expect(text(await html(DisagreementsPage({ searchParams: Promise.resolve({ show: "all" }) }))))
      .toContain("bea-owner");
  });

  it("settle the disagreement", async () => {
    signIn(faculty);
    expect((await staffActions.review(evaluationId)).status).toBe(200);
  });
});

describe("faculty of another cohort", () => {
  it("get the answer a number nobody holds gets, shared recording included", async () => {
    signIn(otherFaculty);
    await setShared(true);
    const ids: Record<string, [number, number]> = {
      submission: [submissionId, MISSING], events: [submissionId, MISSING],
      audio: [sessionId, MISSING], turnAudio: [sessionId, MISSING],
    };
    for (const [name, call] of Object.entries(reads)) {
      const [theirs, nobodys] = ids[name]!;
      const answer = await observed(await call(theirs));
      expect(answer.status, name).toBe(404);
      expect(answer, name).toEqual(await observed(await call(nobodys)));
    }
    await expect(TracePage(params(submissionId))).rejects.toMatchObject(NOT_FOUND);
    await expect(DebriefPage(params(sessionId))).rejects.toMatchObject(NOT_FOUND);
    await expect(SubmissionRecordPage(params(submissionId))).rejects.toMatchObject(NOT_FOUND);
  });

  it("cannot review or correct a grade in another cohort, and learn nothing by trying", async () => {
    signIn(otherFaculty);
    for (const [name, call] of Object.entries(staffActions)) {
      const answer = await observed(await call(evaluationId), evaluationId);
      expect(answer.status, name).toBe(404);
      expect(answer, name).toEqual(await observed(await call(MISSING), MISSING));
    }
    const { rows } = await db().query(
      "select 1 from audit_log where actor_id = $1", [otherFaculty.userId]);
    expect(rows).toHaveLength(0);
  });

  it("do not find the learner on Submissions or on Disagreements", async () => {
    signIn(otherFaculty);
    expect(text(await html(SubmissionsPage({ searchParams: Promise.resolve({}) })))).not.toContain("bea-owner");
    expect(text(await html(DisagreementsPage({ searchParams: Promise.resolve({ show: "all" }) }))))
      .not.toContain("bea-owner");
  });
});

describe("an admin, who reads every cohort", () => {
  it("reads the submission, its trace, its record and a shared recording from another cohort", async () => {
    signIn(admin);
    await setShared(true);
    expect((await reads.submission(submissionId)).status).toBe(200);
    expect(text(await html(TracePage(params(submissionId))))).toContain("Trace replay");
    expect(text(await html(SubmissionRecordPage(params(submissionId))))).toContain(`Submission ${submissionId}`);
    expect((await reads.audio(sessionId)).status).toBe(200);
    expect(text(await html(SubmissionsPage({ searchParams: Promise.resolve({}) })))).toContain("bea-owner");
  });
});

describe("the owner", () => {
  it("reads every part of their own work, and hears their recording unshared", async () => {
    signIn(owner);
    await setShared(false);
    const view = await reads.submission(submissionId);
    expect(view.status).toBe(200);
    expect((await view.json()).id).toBe(submissionId);
    expect((await reads.events(submissionId)).status).toBe(200);
    expect(text(await html(TracePage(params(submissionId))))).toContain("Trace replay");
    expect((await reads.audio(sessionId)).status).toBe(200);

    const debrief = text(await html(DebriefPage(params(sessionId))));
    expect(debrief).toContain(TRANSCRIPT);
    expect(debrief).toContain("Let faculty hear this one session.");
    expect(debrief).toContain("Answer it again");
  });
});

// Last, because a correction settles the disagreement and takes the row off
// the queue the checks above read.
describe("a correction", () => {
  it("is open to faculty of the learner's cohort", async () => {
    signIn(faculty);
    expect((await staffActions.override(evaluationId)).status).toBe(200);
  });
});
