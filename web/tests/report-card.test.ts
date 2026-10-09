/**
 * The report card, story S15.6: docs/11 acceptance 1 to 3, docs/12
 * acceptance 7, and the row that never changes once issued.
 *
 * One builder with the hand-computed heatmap of tests/fixtures/heatmap.ts,
 * written through applyForSubmission as tests/readiness.test.ts writes it,
 * two evaluations saved through eval/, and one scored voice answer carrying
 * delivery numbers, which a report card must never show (docs/07 section 6).
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Learner } from "../lib/session/current.ts";

const session = vi.hoisted(() => ({ learner: null as Learner | null }));

vi.mock("../lib/session/current.ts", async (original) => ({
  ...(await original<typeof import("../lib/session/current.ts")>()),
  currentLearner: async () => {
    if (!session.learner) throw new Error("this check has no session");
    return session.learner;
  },
  // The report card routes' guards resolve the session here and answer 401 to null.
  learnerOrNull: async () => session.learner,
}));

vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));

import {
  buildReportCard, canonicalJson, issueReportCard, reportCard, reportCardMarkdown, reportCardsFor,
} from "../lib/analytics/report-card.ts";
import { closeDb, db, inTransaction } from "../lib/db/pool.ts";
import { applyForSubmission } from "../lib/eval/competency.ts";
import type { Evaluation } from "../lib/eval/consolidate.ts";
import { saveEvaluation } from "../lib/eval/record.ts";
import { seedTracks } from "../lib/policy/roadmap.ts";
import { coverageFor } from "../lib/progress/coverage.ts";
import { readinessFor } from "../lib/progress/readiness.ts";
import { importVoiceQuestion } from "../lib/voice/import.ts";
import LearnerPage from "../app/(shell)/admin/learners/[id]/page.tsx";
import { POST as issueRoute } from "../app/api/admin/learners/[id]/report-cards/route.ts";
import { GET as downloadRoute } from "../app/api/admin/report-cards/[id]/route.ts";
import { seedHandComputedAccount } from "./fixtures/seed-heatmap.ts";
import { importFixtures, resetDatabase, seedLearner } from "./helpers.ts";

const VOICE = path.join(import.meta.dirname, "..", "..", "voice-questions");
const QUESTION = "agent-loop/stop-an-agent-that-never-finishes.yaml";

type Seeded = { enrolmentId: number; cohortId: number; userId: number };
let learner: Seeded;
let faculty: Seeded;

const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/&#x27;|&apos;/g, "'")
  .replace(/&amp;/g, "&").replace(/\s+/g, " ").replace(/ ([.,;:?!])/g, "$1").trim();
const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const params = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });
const request = (url: string, init?: RequestInit) => new Request(`http://localhost${url}`, init);

function signIn(who: Seeded, role: Learner["role"]): void {
  session.learner = { enrolmentId: who.enrolmentId, cohortId: who.cohortId, userId: who.userId,
                      displayName: "someone", role, persona: "builder" };
}

/** A complete evaluation of one of the learner's submissions, saved through eval/. */
async function evaluate(submissionId: number, state: "complete" | "partial" = "complete"): Promise<void> {
  const evaluation: Evaluation = {
    submissionId, complexity: "C2", state, verdict: "pass", score: 90,
    scoreProvisional: state === "partial", confidence: state === "partial" ? "medium" : "high",
    band: null, disagreement: null,
    panel: [{ panelist: "static", status: "ran", ms: 9, findings: [], verdict: "pass", scoreContribution: 90 }],
    feedbackMd: "Every hidden case passed.",
  };
  await saveEvaluation(evaluation, learner.enrolmentId);
}

async function submissionIds(): Promise<number[]> {
  const { rows } = await db().query<{ id: string }>(
    `select s.id from submission s join attempt a on a.id = s.attempt_id
      where a.enrolment_id = $1 order by s.id`, [learner.enrolmentId]);
  return rows.map((row) => Number(row.id));
}

beforeAll(async () => {
  await resetDatabase();
  await importFixtures();
  await seedTracks();
  learner = await seedLearner({ persona: "builder", githubId: 1, login: "ada-okafor" });
  faculty = await seedLearner({ githubId: 2, login: "fern-iyer", cohortId: learner.cohortId });
  await seedHandComputedAccount(learner);
  const [first, second] = await submissionIds();
  await evaluate(first!);
  await evaluate(second!);

  // A scored voice answer whose delivery a report card must leave out.
  await importVoiceQuestion(await readFile(path.join(VOICE, QUESTION), "utf8"), QUESTION);
  const { rows: [question] } = await db().query<{ id: string }>("select id from voice_question limit 1");
  const { rows: [voice] } = await db().query<{ id: string }>(
    `insert into voice_session (enrolment_id, voice_question_id, cohort_id, mode, started_at, finished_at,
                                transcript, content_score, structure_score, pace_score, score, delivery,
                                judge_result, scored_at)
     values ($1, $2, $3, 'guided', now() - interval '3 minutes', now() - interval '1 minute',
             'The loop stops at the budget.', 31.5, 24, 15, 70.5,
             '{"wordsPerMinute": 187, "fillerCount": 23, "longestPauseMs": 9431, "speakingMs": 120000}',
             '{"summary": "Covers the stop condition."}', now())
     returning id`, [learner.enrolmentId, question!.id, learner.cohortId]);
  const { rows: beats } = await db().query<{ beat_key: string }>(
    "select beat_key from voice_beat where voice_question_id = $1 order by ordinal", [question!.id]);
  for (const [index, beat] of beats.entries()) {
    await db().query(
      `insert into voice_beat_result (voice_session_id, beat_key, covered, live_covered, reached_at_ms,
                                      spent_ms, pace_state)
       values ($1, $2, $3, $3, $4, 20000, 'on_pace')`, [voice!.id, beat.beat_key, index === 0, index * 30000]);
  }
}, 120_000);

afterAll(async () => {
  await closeDb();
});

describe("acceptance 1: the same data makes the same hash", () => {
  it("gives two cards issued from unchanged data one hash, as two rows", async () => {
    const issue = () => issueReportCard({ enrolmentId: learner.enrolmentId, issuedBy: faculty.userId });
    const first = await issue();
    const second = await issue();
    expect(second.id).not.toBe(first.id);
    expect(second.sha256).toBe(first.sha256);

    // The hash is SHA-256 over the stored bytes, which are the canonical JSON of the snapshot.
    const stored = await reportCard(first.id, learner.cohortId);
    expect(stored!.sha256).toBe(sha256(stored!.content));
    expect(canonicalJson(JSON.parse(stored!.content))).toBe(stored!.content);
    expect(stored!.snapshot).toEqual(await buildReportCard(learner.enrolmentId));
  });

  it("writes canonical JSON with sorted keys and no whitespace", () => {
    expect(canonicalJson({ b: [2, { d: 1, c: null }], a: "x" })).toBe('{"a":"x","b":[2,{"c":null,"d":1}]}');
  });
});

describe("acceptance 2: a new evaluation makes a new card and leaves the old one readable", () => {
  it("hashes differently, adds a row, and the old card reads as it did", async () => {
    const before = await issueReportCard({ enrolmentId: learner.enrolmentId, issuedBy: faculty.userId });
    const oldCard = (await reportCard(before.id, learner.cohortId))!;
    const oldMarkdown = reportCardMarkdown(oldCard);
    const count = (await reportCardsFor(learner.enrolmentId)).length;

    const ids = await submissionIds();
    await evaluate(ids[ids.length - 1]!);
    const after = await issueReportCard({ enrolmentId: learner.enrolmentId, issuedBy: faculty.userId });

    expect(after.sha256).not.toBe(before.sha256);
    expect(after.snapshot.evaluations).toBe(before.snapshot.evaluations + 1);
    expect(await reportCardsFor(learner.enrolmentId)).toHaveLength(count + 1);
    const reread = (await reportCard(before.id, learner.cohortId))!;
    expect(reread.sha256).toBe(before.sha256);
    expect(reportCardMarkdown(reread)).toBe(oldMarkdown);
  });
});

describe("acceptance 3 and docs/12 acceptance 7: the readiness progress/ shows", () => {
  it("carries the readiness readinessFor gives for the same learner", async () => {
    const card = await issueReportCard({ enrolmentId: learner.enrolmentId, issuedBy: faculty.userId });
    const readiness = await readinessFor(learner.enrolmentId);
    expect(card.snapshot.readiness).toEqual(readiness);
    expect(card.snapshot.coverage).toEqual(await coverageFor(learner.enrolmentId));
    expect(reportCardMarkdown((await reportCard(card.id, learner.cohortId))!))
      .toContain(`Readiness ${readiness.percent} percent`);
  });

  it("equals progress/ inside one transaction, including a change nobody else can see yet", async () => {
    const committed = await readinessFor(learner.enrolmentId);
    const rolledBack = new Error("roll back the fixture");
    await expect(inTransaction(async (client) => {
      // A clean pass on a required cell that is not clean yet, graded through
      // eval/ inside this transaction and never committed.
      const { rows: [problem] } = await client.query<{ id: string; version_id: string }>(
        `select p.id, v.id as version_id from problem p
           join problem_version v on v.problem_id = p.id and v.version = p.current_version
           join track_item i on i.problem_id = p.id and not i.is_optional
           join track t on t.id = i.track_id and t.persona = 'builder'
           join problem_competency pc on pc.problem_id = p.id
          where not exists (select 1 from attempt a where a.problem_id = p.id and a.enrolment_id = $1)
            and not exists (select 1 from competency_score cs
                             where cs.enrolment_id = $1 and cs.competency_id = pc.competency_id
                               and cs.difficulty = p.difficulty and cs.state = 'clean')
          order by p.slug limit 1`, [learner.enrolmentId]);
      const { rows: [attempt] } = await client.query<{ id: string }>(
        `insert into attempt (enrolment_id, problem_id, cohort_id, solved_at)
         values ($1, $2, $3, now()) returning id`, [learner.enrolmentId, problem!.id, learner.cohortId]);
      const { rows: [submission] } = await client.query<{ id: string }>(
        `insert into submission (attempt_id, problem_version_id, kind, body, body_sha256, status,
                                 verdict, llm_calls, finished_at)
         values ($1, $2, 'submit', '# pass', 'in-transaction', 'terminal', 'pass', 0, now())
         returning id`, [attempt!.id, problem!.version_id]);
      await applyForSubmission(client, Number(submission!.id));

      const progress = await readinessFor(learner.enrolmentId, client);
      const card = await issueReportCard(
        { enrolmentId: learner.enrolmentId, issuedBy: faculty.userId }, client);
      expect(card.snapshot.readiness).toEqual(progress);
      expect(progress.clean).toBeGreaterThan(committed.clean);
      throw rolledBack;
    })).rejects.toBe(rolledBack);
    expect(await readinessFor(learner.enrolmentId)).toEqual(committed);
  });
});

describe("a card never changes once issued", () => {
  it("refuses an update, and a row whose hash is not its content's", async () => {
    const card = await issueReportCard({ enrolmentId: learner.enrolmentId, issuedBy: faculty.userId });
    await expect(db().query("update report_card set content = content || ' ' where id = $1", [card.id]))
      .rejects.toThrow(/never changes/);
    await expect(db().query(
      `insert into report_card (enrolment_id, cohort_id, issued_by, content, content_sha256)
       values ($1, $2, $3, '{}', $4)`,
      [learner.enrolmentId, learner.cohortId, faculty.userId, sha256("{ }")]))
      .rejects.toMatchObject({ code: "23514" });
  });
});

describe("what a card says", () => {
  it("dates itself, counts what it summarises, and carries its hash", async () => {
    const card = (await reportCard((await issueReportCard(
      { enrolmentId: learner.enrolmentId, issuedBy: faculty.userId })).id, learner.cohortId))!;
    const markdown = reportCardMarkdown(card);
    const { rows: [counted] } = await db().query<{ n: number }>(
      `select count(*)::int as n from evaluation e join submission s on s.id = e.submission_id
         join attempt a on a.id = s.attempt_id where a.enrolment_id = $1`, [learner.enrolmentId]);
    expect(card.snapshot.evaluations).toBe(counted!.n);
    expect(markdown).toContain(card.sha256);
    expect(markdown).toContain(`Evaluations summarised | ${counted!.n}`);
    expect(markdown).toMatch(/Generated \| \d{1,2} \w+ \d{4}, \d{2}:\d{2} UTC/);
    // The snapshot travels with the card, so anyone holding it can check the hash.
    expect(markdown).toContain("```json\n" + card.content + "\n```");
  });

  it("states its caveats: problems attempted of the catalogue, partial scores, and what it measures", async () => {
    const { rows: [catalogue] } = await db().query<{ n: number }>(
      "select count(*)::int as n from problem where is_published");
    const coverage = await coverageFor(learner.enrolmentId);
    const ids = await submissionIds();
    await evaluate(ids[0]!, "partial");
    const card = (await reportCard((await issueReportCard(
      { enrolmentId: learner.enrolmentId, issuedBy: faculty.userId })).id, learner.cohortId))!;
    expect(card.snapshot.caveats).toEqual({
      problemsPractised: coverage.practised, catalogue: catalogue!.n, provisional: 1,
    });
    const markdown = reportCardMarkdown(card);
    expect(markdown).toContain(`${coverage.practised} of the ${catalogue!.n} problems`);
    expect(markdown).toMatch(/1 score in this sample is provisional/);
    expect(markdown).toMatch(/agent engineering/);
  });

  it("leaves out delivery and panelist names, and keeps the voice scores", async () => {
    const card = (await reportCard((await issueReportCard(
      { enrolmentId: learner.enrolmentId, issuedBy: faculty.userId })).id, learner.cohortId))!;
    expect(card.content).not.toMatch(/wordsPerMinute|fillerCount|longestPause|speakingMs|delivery/);
    for (const number of ["187", "9431", "120000"]) expect(card.content).not.toContain(number);
    const markdown = reportCardMarkdown(card);
    for (const number of ["187", "9431"]) expect(markdown).not.toContain(number);
    expect(`${card.content}\n${markdown}`).not.toMatch(/\b(pretrained|llm|panelist)\b/i);
    expect(card.snapshot.voice.answers).toEqual([expect.objectContaining({
      score: 70.5, content: 31.5, structure: 24, pace: 15, beatsCovered: 1,
    })]);
  });
});

describe("issuing and downloading from the learner page", () => {
  it("refuses a learner, naming who can issue one", async () => {
    signIn(learner, "learner");
    const refused = await issueRoute(request(`/api/admin/learners/${learner.enrolmentId}/report-cards`,
      { method: "POST" }), params(learner.enrolmentId));
    expect(refused.status).toBe(403);
    expect((await refused.json()).message).toMatch(/faculty and admins/);
  });

  it("lets faculty issue one, list it on the page and download it as Markdown", async () => {
    signIn(faculty, "faculty");
    const issued = await issueRoute(request(`/api/admin/learners/${learner.enrolmentId}/report-cards`,
      { method: "POST" }), params(learner.enrolmentId));
    expect(issued.status).toBe(200);
    const { id, sha256: hash } = await issued.json() as { id: number; sha256: string };

    const page = await LearnerPage(params(learner.enrolmentId)) as ReactElement;
    const markup = renderToStaticMarkup(page);
    const cards = /<h2 id="report-cards"[\s\S]*?<\/section>/.exec(markup)![0];
    expect((cards.match(/<tbody[\s\S]*?<\/tbody>/)?.[0].match(/<tr[ >]/g) ?? []).length)
      .toBe((await reportCardsFor(learner.enrolmentId)).length);
    expect(cards).toContain(`href="/api/admin/report-cards/${id}"`);
    expect(text(cards)).toContain(hash.slice(0, 12));

    const download = await downloadRoute(request(`/api/admin/report-cards/${id}`), params(id));
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toMatch(/^text\/markdown/);
    expect(download.headers.get("content-disposition")).toContain(`ada-okafor`);
    expect(await download.text()).toContain(hash);
  });

  it("finds no card from another cohort", async () => {
    const { rows: [other] } = await db().query<{ id: string }>(
      "insert into cohort (slug, name, starts_on) values ('c9', 'Cohort 9', current_date) returning id");
    session.learner = { enrolmentId: 0, cohortId: Number(other!.id), userId: faculty.userId,
                        displayName: "elsewhere", role: "admin", persona: "builder" };
    const [card] = await reportCardsFor(learner.enrolmentId);
    const response = await downloadRoute(request(`/api/admin/report-cards/${card!.id}`), params(card!.id));
    expect(response.status).toBe(404);
  });
});
