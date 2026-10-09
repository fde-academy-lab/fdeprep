/**
 * analytics/, story S15.5: docs/11 acceptance 5 to 8 over the seed, the
 * competency gaps view the story's acceptance line names, and interview
 * coverage from docs/12 section 5 and acceptance 9.
 *
 * The seed runs once at the test plan's scale, through the production write
 * paths, as tests/admin-overview.test.ts runs it. Where the seed lacks a case
 * a test needs (a partial evaluation, a pass after three failed submits, a
 * problem marked oral), the test adds it beside the seed and says so.
 * Expected numbers come from SQL written here, never from the module under
 * test, so the two have to agree rather than one checking itself.
 */
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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
  // The export routes' guards resolve the session here and answer 401 to null.
  learnerOrNull: async () => session.learner,
}));

vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));

import { overview } from "../lib/admin/overview.ts";
import { calibrationMarkdown, calibrationReport, MIN_SAMPLE } from "../lib/analytics/calibration.ts";
import { interviewCoverage } from "../lib/analytics/coverage.ts";
import { competencyGaps } from "../lib/analytics/gaps.ts";
import { panelHealth } from "../lib/analytics/panel-health.ts";
import { STUCK_AT_FAILED_SUBMITS, stuckList } from "../lib/analytics/stuck.ts";
import { closeDb, db } from "../lib/db/pool.ts";
import type { Evaluation } from "../lib/eval/consolidate.ts";
import { reevaluationBacklog, saveEvaluation } from "../lib/eval/record.ts";
import { seedTracks } from "../lib/policy/roadmap.ts";
import { coverageFor } from "../lib/progress/coverage.ts";
import { loadCatalogue } from "../lib/seed/catalogue.ts";
import { plan, type SeedPlan } from "../lib/seed/plan.ts";
import { runSeed, type SeedReport } from "../lib/seed/run.ts";
import { importVoiceQuestion } from "../lib/voice/import.ts";
import AdminLayout from "../app/(shell)/admin/layout.tsx";
import CohortPage, { metadata as cohortMeta } from "../app/(shell)/admin/cohort/page.tsx";
import CalibrationPage, { metadata as calibrationMeta } from "../app/(shell)/admin/calibration/page.tsx";
import PanelPage, { metadata as panelMeta } from "../app/(shell)/admin/panel/page.tsx";
import LearnerPage from "../app/(shell)/admin/learners/[id]/page.tsx";
import { GET as standingCsv } from "../app/api/admin/cohort/standing/route.ts";
import { GET as calibrationExport } from "../app/api/admin/calibration/route.ts";
import { importFixtures, resetDatabase } from "./helpers.ts";

const VOICE = path.join(import.meta.dirname, "..", "..", "voice-questions");
/** The three tests/admin-overview.test.ts imports, so the test plan draws the same rows. */
const QUESTIONS = [
  "agent-loop/stop-an-agent-that-never-finishes.yaml",
  "client-communication/say-no-to-the-date.yaml",
  "tool-schema-design/retry-a-tool-that-may-have-acted.yaml",
];
const NOT_FOUND = { digest: "NEXT_HTTP_ERROR_FALLBACK;404" };

const html = async (page: ReactElement | Promise<ReactElement>) => renderToStaticMarkup(await page);
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/&#x27;|&apos;/g, "'")
  .replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/\s+/g, " ")
  .replace(/ ([.,;:?!])/g, "$1").trim();
const h1 = (markup: string) => text(/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(markup)?.[1] ?? "");
const bodyRows = (markup: string) => (markup.match(/<tbody[\s\S]*?<\/tbody>/g) ?? [])
  .reduce((n, body) => n + (body.match(/<tr[ >]/g) ?? []).length, 0);
const section = (markup: string, id: string) =>
  new RegExp(`<h2 id="${id}"[\\s\\S]*?</section>`).exec(markup)?.[0] ?? "";
const params = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });

let seeded: SeedPlan;
let report: SeedReport;
let embedDir: string | undefined;

beforeAll(async () => {
  // As tests/seed.test.ts does: no embedding weights, so panelist 2 reports an
  // absence on every host and the seed comes out the same.
  embedDir = process.env["FDEPREP_EMBED_MODEL_DIR"];
  process.env["FDEPREP_EMBED_MODEL_DIR"] = await mkdtemp(path.join(tmpdir(), "fdeprep-analytics-"));

  await resetDatabase();
  await importFixtures();
  for (const file of QUESTIONS) {
    await importVoiceQuestion(await readFile(path.join(VOICE, file), "utf8"), file);
  }
  await seedTracks();
  seeded = plan({ today: "2026-10-08", catalogue: await loadCatalogue(), scale: "test" });
  report = await runSeed(seeded);
}, 240_000);

afterAll(async () => {
  if (embedDir === undefined) delete process.env["FDEPREP_EMBED_MODEL_DIR"];
  else process.env["FDEPREP_EMBED_MODEL_DIR"] = embedDir;
  await closeDb();
});

function signIn(login: string, role: Learner["role"]): Learner {
  const account = report.accounts.get(login)!;
  session.learner = {
    enrolmentId: account.enrolmentId, cohortId: account.cohortId, userId: account.userId,
    displayName: login, role, persona: "navigator",
  };
  return session.learner;
}

const cohortIds = () => [...report.cohorts.values()];
const account = (login: string) => report.accounts.get(login)!;

/** A problem this learner has never opened, with its current version. */
async function untouchedProblem(enrolmentId: number): Promise<{ id: number; versionId: number }> {
  const { rows } = await db().query<{ id: string; version_id: string }>(
    `select p.id, v.id as version_id from problem p
       join problem_version v on v.problem_id = p.id and v.version = p.current_version
      where not exists (select 1 from attempt a where a.problem_id = p.id and a.enrolment_id = $1)
      order by p.slug limit 1`, [enrolmentId]);
  return { id: Number(rows[0]!.id), versionId: Number(rows[0]!.version_id) };
}

/** Finished submits written straight into the tables, the way tests/fixtures/seed-heatmap.ts does. */
async function submits(
  learner: { enrolmentId: number; cohortId: number }, problem: { id: number; versionId: number },
  verdicts: Array<"pass" | "fail">,
): Promise<number> {
  const { rows: [attempt] } = await db().query<{ id: string }>(
    `insert into attempt (enrolment_id, problem_id, cohort_id) values ($1, $2, $3)
     on conflict (enrolment_id, problem_id) do update set problem_id = excluded.problem_id
     returning id`, [learner.enrolmentId, problem.id, learner.cohortId]);
  for (const [index, verdict] of verdicts.entries()) {
    await db().query(
      `insert into submission (attempt_id, problem_version_id, kind, body, body_sha256, status,
                               verdict, finished_at)
       values ($1, $2, 'submit', $3, $4, 'terminal', $5::verdict, now())`,
      [attempt!.id, problem.versionId, `# try ${index}`, `fixture-${attempt!.id}-${index}`, verdict]);
    if (verdict === "pass") {
      await db().query("update attempt set solved_at = coalesce(solved_at, now()) where id = $1",
        [attempt!.id]);
    }
  }
  return Number(attempt!.id);
}

describe("acceptance 5: the stuck list", () => {
  it("lists each stalled learner's problem, one row per learner and problem pair", async () => {
    const stalled = seeded.people.filter((p) => p.archetype === "stalled").map((p) => p.login);
    expect(stalled.length).toBeGreaterThan(0);
    const rows = (await Promise.all(cohortIds().map((id) => stuckList(id)))).flat();
    expect([...new Set(rows.map((row) => row.login))].sort()).toEqual(stalled.sort());

    const { rows: expected } = await db().query<{ login: string; slug: string; fails: number }>(
      `select u.github_login as login, p.slug,
              (select count(*) from submission s where s.attempt_id = a.id and s.kind = 'submit'
                 and s.verdict = 'fail')::int as fails
         from attempt a join enrolment e on e.id = a.enrolment_id and e.role = 'learner'
         join app_user u on u.id = e.user_id join problem p on p.id = a.problem_id
        where not exists (select 1 from submission s where s.attempt_id = a.id
                            and s.kind = 'submit' and s.verdict = 'pass')
          and (select count(*) from submission s where s.attempt_id = a.id and s.kind = 'submit'
                 and s.verdict = 'fail') >= 3
        order by 1, 2`);
    expect(rows.map((row) => ({ login: row.login, slug: row.slug, fails: row.failedSubmits }))
      .sort((a, b) => a.login.localeCompare(b.login) || a.slug.localeCompare(b.slug)))
      .toEqual(expected);
    expect(STUCK_AT_FAILED_SUBMITS).toBe(3);
  });

  it("finds a pair at three failed submits and drops it once a pass lands", async () => {
    // The seed's learners either pass within two retries or stay stalled, so
    // three failures and then a pass is added here.
    const priya = account("priya-raghavan");
    const problem = await untouchedProblem(priya.enrolmentId);
    const attemptId = await submits(priya, problem, ["fail", "fail", "fail"]);
    const listed = async () => (await stuckList(priya.cohortId))
      .some((row) => row.enrolmentId === priya.enrolmentId && row.problemId === problem.id);

    expect(await listed()).toBe(true);
    await submits(priya, problem, ["pass"]);
    expect(await listed()).toBe(false);
    expect(attemptId).toBeGreaterThan(0);
  });

  it("agrees with the Overview's stuck count for every learner", async () => {
    for (const cohortId of cohortIds()) {
      const rows = await stuckList(cohortId);
      for (const row of (await overview(cohortId)).rows) {
        expect(rows.filter((r) => r.enrolmentId === row.enrolmentId).length, row.login).toBe(row.stuck);
      }
    }
  });

  it("names its meaning on the Cohort page, and Ops says waiting for the other one", async () => {
    signIn("meera-iyer", "faculty");
    const markup = await html(CohortPage());
    const stuck = section(markup, "stuck");
    expect(text(stuck)).toContain(`${STUCK_AT_FAILED_SUBMITS} or more failed submits and no pass`);
    expect(bodyRows(stuck)).toBe((await stuckList(account("meera-iyer").cohortId)).length);
  });
});

describe("acceptance 6: panel health", () => {
  async function counts() {
    const { rows: [row] } = await db().query<{ runs: number; partial: number; complete: number }>(
      `select count(*)::int as runs,
              count(*) filter (where state = 'partial')::int as partial,
              count(*) filter (where state = 'complete')::int as complete
         from evaluation
        where overridden_by is null and created_at > now() - interval '7 days'`);
    return row!;
  }

  it("counts a partial once, and its completed re-run as one more complete run", async () => {
    // The seed writes no partial evaluation, so one is added: a design answer
    // graded while panelist 3 was down, then the free re-run that completes it.
    const { rows: [design] } = await db().query<{ id: string; enrolment_id: string }>(
      `select s.id, a.enrolment_id from submission s join attempt a on a.id = s.attempt_id
         join problem_version v on v.id = s.problem_version_id join problem p on p.id = v.problem_id
        where p.artefact_type = 'design' and s.verdict = 'pass' order by s.id limit 1`);
    const submissionId = Number(design!.id);
    const seat = (panelist: "static" | "pretrained" | "llm", ran: boolean) => ran
      ? { panelist, status: "ran" as const, ms: panelist === "llm" ? 2100 : 40, findings: [],
          ...(panelist === "static" ? { verdict: "pass" as const, scoreContribution: 62.5 }
            : { band: "adequate" as const }) }
      : { panelist, status: "unavailable" as const, reason: "deadline_exceeded", ms: 4000,
          findings: [] };
    const evaluation = (state: "partial" | "complete"): Evaluation => ({
      submissionId, complexity: "C4", state, verdict: "pass", score: 62.5,
      scoreProvisional: state === "partial", confidence: state === "partial" ? "medium" : "high",
      band: "adequate", disagreement: null,
      panel: [seat("static", true), seat("pretrained", true), seat("llm", state === "complete")],
      feedbackMd: "The answer names the trade and holds to the constraint.",
    });

    const before = await panelHealth();
    expect(before.partial).toBe(0);
    expect(before.runs).toBe((await counts()).runs);

    await saveEvaluation(evaluation("partial"), Number(design!.enrolment_id));
    const partial = await panelHealth();
    expect(partial.partial).toBe((await counts()).partial);
    expect(partial.partial).toBe(1);
    expect(partial.runs).toBe(before.runs + 1);
    expect(partial.backlog).toBe((await reevaluationBacklog(1000)).length);
    expect(partial.backlog).toBe(1);

    await saveEvaluation(evaluation("complete"), Number(design!.enrolment_id));
    const settled = await panelHealth();
    const after = await counts();
    expect(settled.partial).toBe(after.partial);
    expect(settled.partial).toBe(1);
    expect(settled.complete).toBe(after.complete);
    expect(settled.runs).toBe(before.runs + 2);
    expect(settled.partialRate).toBeCloseTo(1 / settled.runs, 10);
    expect(settled.backlog).toBe(0);
  });

  it("reads panelist availability and P3 latency from the panel record", async () => {
    const health = await panelHealth();
    const { rows: [llm] } = await db().query<{ ran: number; down: number; median: number | null }>(
      `select count(*) filter (where seat ->> 'status' = 'ran')::int as ran,
              count(*) filter (where seat ->> 'status' = 'unavailable')::int as down,
              percentile_cont(0.5) within group (order by (seat ->> 'ms')::numeric)
                filter (where seat ->> 'status' = 'ran') as median
         from evaluation e cross join lateral jsonb_array_elements(e.panel) seat
        where e.overridden_by is null and e.created_at > now() - interval '7 days'
          and seat ->> 'panelist' = 'llm'`);
    expect(health.llm.ran).toBe(llm!.ran);
    expect(health.llm.unavailable).toBe(llm!.down);
    expect(health.llm.medianMs).toBe(llm!.median === null ? null : Math.round(Number(llm!.median)));
    const lastDay = health.hours.reduce((n, hour) => n + hour.runs, 0);
    const { rows: [day] } = await db().query<{ n: number }>(
      `select count(*)::int as n from evaluation
        where overridden_by is null and created_at > now() - interval '24 hours'`);
    expect(lastDay).toBe(day!.n);
  });

  it("shows the Panel tab to an admin only, with the partial rate on it", async () => {
    signIn("meera-iyer", "faculty");
    await expect(PanelPage()).rejects.toMatchObject(NOT_FOUND);
    signIn("daniel-osei", "admin");
    const markup = await html(PanelPage());
    expect(h1(markup)).toBe(panelMeta.title);
    const health = await panelHealth();
    expect(text(markup)).toContain(`${health.partial} of ${health.runs} ${health.runs === 1 ? "run" : "runs"}`);
  });
});

describe("acceptance 7: a learner asking for a cohort view", () => {
  it("is refused, and the refusal names who can see it", async () => {
    signIn("priya-raghavan", "learner");
    const refused = await standingCsv();
    expect(refused.status).toBe(403);
    expect(await refused.text()).toMatch(/faculty and admins/);
    const calibration = await calibrationExport();
    expect(calibration.status).toBe(403);
    expect(await calibration.text()).toMatch(/faculty and admins/);
    // The pages sit behind the admin layout, which answers a learner with its 404.
    await expect(AdminLayout({ children: null })).rejects.toMatchObject(NOT_FOUND);
  });

  it("gives faculty the cohort standing as a CSV that carries its date and its row count", async () => {
    signIn("meera-iyer", "faculty");
    const response = await standingCsv();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^text\/csv/);
    expect(response.headers.get("content-disposition")).toMatch(/fdeprep-standing-seed-c3-\d{4}-\d{2}-\d{2}\.csv/);
    const lines = (await response.text()).trimEnd().split("\n");
    const rows = (await overview(account("meera-iyer").cohortId)).rows;
    expect(lines[0]).toMatch(new RegExp(`^# Cohort standing for seed-c3 generated \\d{4}-\\d{2}-\\d{2}T[\\d:.]+Z covering ${rows.length} learners$`));
    expect(lines[1]).toBe("login,name,persona,state,readiness,band,clean,passed,attempted," +
                          "untouched,required,practised,written,oral,last_activity,stuck");
    expect(lines).toHaveLength(rows.length + 2);
    const priya = lines.find((line) => line.startsWith("priya-raghavan,"))!;
    const readiness = rows.find((row) => row.login === "priya-raghavan")!.readiness!;
    expect(priya.split(",").slice(4, 11)).toEqual([
      String(readiness.percent), readiness.band, String(readiness.clean), String(readiness.passed),
      String(readiness.attempted), String(readiness.untouched), String(readiness.required)]);
    // docs/07 section 6: delivery is never exported.
    expect(lines[1]).not.toMatch(/filler|words_per_minute|wpm|pause|silence/);
  });
});

describe("acceptance 8: calibration", () => {
  it("names a Medium problem whose first-attempt pass rate is above 90 percent", async () => {
    // The test plan has six learners, so no problem reaches the default
    // sample; two first attempts is the most any Medium problem has here.
    const minSample = 2;
    const { rows: expected } = await db().query<{ slug: string; medium: boolean }>(
      `with firsts as (
         select distinct on (a.id) a.problem_id, s.verdict
           from attempt a join submission s on s.attempt_id = a.id
           join enrolment e on e.id = a.enrolment_id and e.role = 'learner'
          where s.kind = 'submit' and s.verdict in ('pass', 'fail')
          order by a.id, s.queued_at, s.id)
       select p.slug, p.difficulty = 'medium' as medium from problem p join firsts f on f.problem_id = p.id
        where p.is_published and p.difficulty <> 'easy'
        group by p.slug, p.difficulty
       having count(*) >= $1 and count(*) filter (where f.verdict = 'pass')::numeric / count(*) > 0.9
        order by 1`, [minSample]);
    expect(expected.some((row) => row.medium)).toBe(true);

    const calibration = await calibrationReport({ minSample });
    const named = calibration.findings.filter((f) => f.signal === "first_pass_high");
    expect(named.map((f) => f.slug).sort()).toEqual(expected.map((row) => row.slug));
    for (const finding of named) {
      expect(finding.value).toBeGreaterThan(0.9);
      expect(finding.check.length).toBeGreaterThan(20);
    }
  });

  it("names nothing on fewer first attempts than the minimum sample", async () => {
    expect(MIN_SAMPLE).toBe(5);
    const calibration = await calibrationReport();
    expect(calibration.findings.filter((f) => f.signal === "first_pass_high")).toEqual([]);
  });

  it("writes Markdown carrying the date and the number of problems it covers", async () => {
    const calibration = await calibrationReport({ minSample: 2 });
    const markdown = calibrationMarkdown(calibration);
    expect(markdown).toMatch(/^# Calibration report\n/);
    expect(markdown).toContain(`Generated ${calibration.generatedAt}`);
    expect(markdown).toContain(`${calibration.problems} published problems`);
    for (const finding of calibration.findings) expect(markdown).toContain(finding.slug);

    signIn("meera-iyer", "faculty");
    const response = await calibrationExport();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^text\/markdown/);
  });

  it("opens the Calibration tab to faculty, with the tab title as its h1", async () => {
    signIn("meera-iyer", "faculty");
    const markup = await html(CalibrationPage());
    expect(h1(markup)).toBe(calibrationMeta.title);
  });
});

describe("competency gaps: which topic the cohort failed", () => {
  it("leads with the competency the fewest learners who tried it have passed", async () => {
    const cohortId = account("meera-iyer").cohortId;
    const { rows: expected } = await db().query<{
      slug: string; attempted: number; passed: number; learners: number;
    }>(
      `with learners as (
         select id from enrolment where cohort_id = $1 and role = 'learner' and state = 'active'),
       best as (
         select cs.enrolment_id, cs.competency_id,
                max(case cs.state when 'clean' then 3 when 'passed' then 2 else 1 end) as rank
           from competency_score cs join learners l on l.id = cs.enrolment_id
          group by 1, 2)
       select c.slug, count(b.*)::int as attempted, count(b.*) filter (where b.rank >= 2)::int as passed,
              (select count(*) from learners)::int as learners
         from competency c join best b on b.competency_id = c.id
        group by c.slug`, [cohortId]);
    expect(expected.length).toBeGreaterThan(0);

    const gaps = await competencyGaps(cohortId);
    expect(gaps.learners).toBe(expected[0]!.learners);
    const tried = gaps.rows.filter((row) => row.attempted > 0);
    expect(tried.map((row) => [row.slug, row.attempted, row.passed]).sort())
      .toEqual(expected.map((row) => [row.slug, row.attempted, row.passed]).sort());
    // Lowest pass rate first, so the gap the next session covers is the first row.
    for (let i = 1; i < tried.length; i += 1) {
      expect(tried[i]!.passRate!).toBeGreaterThanOrEqual(tried[i - 1]!.passRate!);
    }
    const lowest = Math.min(...expected.map((row) => row.passed / row.attempted));
    expect(tried[0]!.passed / tried[0]!.attempted).toBe(lowest);
  });

  it("names that competency in a sentence on the Cohort page, for faculty without SQL", async () => {
    signIn("meera-iyer", "faculty");
    const markup = await html(CohortPage());
    expect(h1(markup)).toBe(cohortMeta.title);
    const gaps = await competencyGaps(account("meera-iyer").cohortId);
    const first = gaps.rows[0]!;
    const name = first.name.charAt(0).toUpperCase() + first.name.slice(1);
    expect(text(section(markup, "gaps"))).toContain(
      `Lowest pass rate: ${name}. ${first.passed} of ${first.attempted} learners who attempted it have passed it.`);
  });
});

describe("interview coverage: docs/12 section 5 and acceptance 9", () => {
  async function practised(enrolmentId: number): Promise<string[]> {
    const { rows } = await db().query<{ slug: string }>(
      `select distinct p.slug from attempt a join problem p on p.id = a.problem_id
        where a.enrolment_id = $1 and exists (select 1 from submission s where s.attempt_id = a.id
                                                and s.verdict in ('pass', 'fail'))
        order by 1`, [enrolmentId]);
    return rows.map((row) => row.slug);
  }

  async function markRound(slug: string, round: "written" | "oral" | "both"): Promise<void> {
    await db().query(
      `update problem_version v set interview = jsonb_build_object('round', $2::text,
                                     'asked_as', coalesce(v.interview ->> 'asked_as', 'A question.'))
         from problem p where p.slug = $1 and v.problem_id = p.id and v.version = p.current_version`,
      [slug, round]);
  }

  it("counts distinct problems practised per round, and one marked both toward each", async () => {
    const tunde = account("tbakare").enrolmentId;
    const slugs = await practised(tunde);
    expect(slugs.length).toBeGreaterThanOrEqual(3);
    expect(await coverageFor(tunde)).toEqual({ practised: slugs.length, written: slugs.length, oral: 0 });

    // Every fixture problem is written, so two are marked here.
    await markRound(slugs[0]!, "both");
    await markRound(slugs[1]!, "oral");
    expect(await coverageFor(tunde)).toEqual({
      practised: slugs.length, written: slugs.length - 1, oral: 2,
    });
    await markRound(slugs[0]!, "written");
    await markRound(slugs[1]!, "written");
  });

  it("counts the catalogue and the cohort per round", async () => {
    const cohortId = account("meera-iyer").cohortId;
    const { rows: [published] } = await db().query<{ n: number }>(
      "select count(*)::int as n from problem where is_published");
    const coverage = await interviewCoverage(cohortId);
    const written = coverage.rows.find((row) => row.round === "written")!;
    const oral = coverage.rows.find((row) => row.round === "oral")!;
    expect(written.catalogue).toBe(published!.n);
    expect(oral.catalogue).toBe(0);
    const active = ["priya-raghavan", "tbakare", "maricel-dizon"];
    const union = new Set((await Promise.all(active.map((l) => practised(account(l).enrolmentId)))).flat());
    expect(written.practised).toBe(union.size);
    expect(written.learners).toBe(active.length);
  });

  it("shows the coverage line beside readiness on the admin learner page", async () => {
    signIn("meera-iyer", "faculty");
    const priya = account("priya-raghavan").enrolmentId;
    const coverage = await coverageFor(priya);
    const markup = await html(LearnerPage(params(priya)));
    expect(text(markup)).toContain(`Practised: written ${coverage.written} · oral ${coverage.oral}`);
  });
});
