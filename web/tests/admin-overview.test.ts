/**
 * Step 4 of the redesign, story S17.4: the admin screens over the seed.
 *
 * The seed runs once, at the test plan's scale, through the production write
 * paths, and every check reads what the admin screens read from it. Pages are
 * rendered the way Next renders a server component, by awaiting the page and
 * rendering what it returns, with the session swapped for the role a check
 * needs.
 */
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createElement, type ReactElement } from "react";
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
}));

// The dialogs ask for the router, which only a running app has. Nothing here navigates.
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));

import { roster } from "../lib/admin/index.ts";
import { sevenDays } from "../lib/admin/ops.ts";
import { overview, sortRows, type OverviewRow } from "../lib/admin/overview.ts";
import { closeDb, db } from "../lib/db/pool.ts";
import { seedTracks } from "../lib/policy/roadmap.ts";
import { readinessFor } from "../lib/progress/readiness.ts";
import { loadCatalogue } from "../lib/seed/catalogue.ts";
import { plan, type SeedPlan } from "../lib/seed/plan.ts";
import { runSeed, type SeedReport } from "../lib/seed/run.ts";
import { importVoiceQuestion } from "../lib/voice/import.ts";
import AdminLayout from "../app/(shell)/admin/layout.tsx";
import OverviewPage, { metadata as overviewMeta } from "../app/(shell)/admin/page.tsx";
import LearnerPage, { generateMetadata } from "../app/(shell)/admin/learners/[id]/page.tsx";
import RosterPage, { metadata as rosterMeta } from "../app/(shell)/admin/roster/page.tsx";
import SubmissionsPage, { metadata as submissionsMeta } from "../app/(shell)/admin/submissions/page.tsx";
import DisagreementsPage, { metadata as disagreementsMeta } from "../app/(shell)/admin/disagreements/page.tsx";
import OpsPage, { metadata as opsMeta } from "../app/(shell)/admin/ops/page.tsx";
import ImportPage, { metadata as importMeta } from "../app/(shell)/admin/import/page.tsx";
import CohortPage, { metadata as cohortMeta } from "../app/(shell)/admin/cohort/page.tsx";
import CalibrationPage, { metadata as calibrationMeta } from "../app/(shell)/admin/calibration/page.tsx";
import PanelPage, { metadata as panelMeta } from "../app/(shell)/admin/panel/page.tsx";
import TracePage from "../app/(shell)/traces/[id]/page.tsx";
import { importFixtures, resetDatabase } from "./helpers.ts";

const VOICE = path.join(import.meta.dirname, "..", "..", "voice-questions");
const QUESTIONS = [
  "agent-loop/stop-an-agent-that-never-finishes.yaml",
  "client-communication/say-no-to-the-date.yaml",
  "tool-schema-design/retry-a-tool-that-may-have-acted.yaml",
];
const NOT_FOUND = { digest: "NEXT_HTTP_ERROR_FALLBACK;404" };

const html = async (page: ReactElement | Promise<ReactElement>) => renderToStaticMarkup(await page);
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/&#x27;|&apos;/g, "'")
  .replace(/&amp;/g, "&").replace(/\s+/g, " ").replace(/ ([.,;:?!])/g, "$1").trim();
const h1 = (markup: string) => text(/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(markup)?.[1] ?? "");
/** What is on screen: a closed dialog's markup is in the page but not visible. */
const visible = (markup: string) => text(markup.replace(/<dialog[\s\S]*?<\/dialog>/g, ""));
/** Rows in every table body, header rows left out. */
const bodyRows = (markup: string) => (markup.match(/<tbody[\s\S]*?<\/tbody>/g) ?? [])
  .reduce((n, body) => n + (body.match(/<tr[ >]/g) ?? []).length, 0);
const query = (value: Record<string, string> = {}) => ({ searchParams: Promise.resolve(value) });
const params = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });

let seeded: SeedPlan;
let report: SeedReport;
let embedDir: string | undefined;

beforeAll(async () => {
  // As tests/seed.test.ts does: no embedding weights here, so panelist 2
  // reports an absence on every host and the seed comes out the same.
  embedDir = process.env["FDEPREP_EMBED_MODEL_DIR"];
  process.env["FDEPREP_EMBED_MODEL_DIR"] = await mkdtemp(path.join(tmpdir(), "fdeprep-overview-"));

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

/** Signs in as a seeded account with the role the seed gave it. */
function signIn(login: string, role: Learner["role"]): Learner {
  const account = report.accounts.get(login)!;
  session.learner = {
    enrolmentId: account.enrolmentId, cohortId: account.cohortId, userId: account.userId,
    displayName: login, role, persona: "navigator",
  };
  return session.learner;
}

const cohortIds = () => [...report.cohorts.values()];

describe("who may open the Overview", () => {
  it("lets faculty open /admin and a learner's page, and gives a learner the layout's 404", async () => {
    signIn("meera-iyer", "faculty");
    const layout = await html(AdminLayout({ children: createElement("p", null, "page") }));
    expect(text(layout)).toBe("Overview Cohort Roster Submissions Disagreements Calibration page");
    const page = await html(OverviewPage(query()));
    expect(h1(page)).toBe("Overview");
    expect(text(page)).toContain("priya-raghavan");

    const priya = report.accounts.get("priya-raghavan")!.enrolmentId;
    const learnerPage = await html(LearnerPage(params(priya)));
    expect(h1(learnerPage)).toBe("Priya Raghavan");
    for (const block of ["Readiness", "Competency heatmap", "Attempt history", "Past answers"]) {
      expect(learnerPage).toContain(`>${block}</h2>`);
    }

    signIn("priya-raghavan", "learner");
    await expect(AdminLayout({ children: null })).rejects.toMatchObject(NOT_FOUND);
  });

  it("shows an admin every tab", async () => {
    signIn("daniel-osei", "admin");
    const layout = await html(AdminLayout({ children: null }));
    expect(text(layout)).toBe(
      "Overview Cohort Roster Problems Submissions Disagreements Calibration Panel Ops");
  });

  it("refuses an unknown learner, staff, and a learner from another cohort", async () => {
    signIn("meera-iyer", "faculty");
    const other = report.accounts.get("mateus-costa")!.enrolmentId;
    for (const id of ["999999", "not-a-number", String(report.accounts.get("daniel-osei")!.enrolmentId),
                      String(other)]) {
      await expect(LearnerPage(params(id))).rejects.toMatchObject(NOT_FOUND);
    }
  });

  it("opens a learner's trace to that learner and to staff, and to no other learner", async () => {
    const priya = report.accounts.get("priya-raghavan")!.enrolmentId;
    const { rows: [traced] } = await db().query<{ id: string }>(
      `select s.id from submission s join trace t on t.submission_id = s.id
         join attempt a on a.id = s.attempt_id where a.enrolment_id = $1 limit 1`, [priya]);
    const id = Number(traced!.id);
    for (const [login, role] of [["priya-raghavan", "learner"], ["meera-iyer", "faculty"],
                                 ["daniel-osei", "admin"]] as const) {
      signIn(login, role);
      expect(h1(await html(TracePage(params(id)))), login).toBe("Trace replay");
    }
    signIn("tbakare", "learner");
    await expect(TracePage(params(id))).rejects.toMatchObject(NOT_FOUND);
  });

  it("keeps Ops admin only", async () => {
    signIn("meera-iyer", "faculty");
    await expect(OpsPage()).rejects.toMatchObject(NOT_FOUND);
  });
});

describe("the Overview reads the numbers the other screens read", () => {
  it("gives every active learner the readiness readinessFor gives, and none to a paused or ended one", async () => {
    let compared = 0;
    for (const cohortId of cohortIds()) {
      for (const row of (await overview(cohortId)).rows) {
        if (row.state !== "active") {
          expect(row.readiness).toBeNull();
          continue;
        }
        expect(row.readiness).toEqual(await readinessFor(row.enrolmentId));
        compared += 1;
      }
    }
    expect(compared).toBeGreaterThanOrEqual(4);
    // Seed learner one, by name, since docs/12 section 6 names the check.
    const priya = report.accounts.get("priya-raghavan")!;
    const row = (await overview(priya.cohortId)).rows.find((r) => r.login === "priya-raghavan")!;
    expect(row.readiness).toEqual(await readinessFor(priya.enrolmentId));
  });

  it("agrees with Roster and Ops on last activity for every seeded learner", async () => {
    const days = new Map((await sevenDays()).map((day) => [day.date, day]));
    for (const cohortId of cohortIds()) {
      const cohort = await overview(cohortId);
      const listed = new Map((await roster(cohortId)).map((row) => [row.login, row.lastActivity]));
      for (const row of cohort.rows) {
        expect(row.lastActivity, row.login).toBe(listed.get(row.login));
        // A learner active this week shows on the Ops day they were last active.
        const day = row.lastActivity ? days.get(row.lastActivity.slice(0, 10)) : undefined;
        if (day) expect(day.runs + day.submits + day.voiceAnswers, row.login).toBeGreaterThan(0);
      }
      expect(cohort.activeThisWeek).toBe(cohort.rows.filter((row) =>
        row.lastActivity && Date.now() - Date.parse(row.lastActivity) < 7 * 86_400_000).length);
    }

    // The voice-only learner, who never ran anything, reads their latest answer.
    const ruth = report.accounts.get("ruth-adeyemi")!;
    const { rows } = await db().query<{ started_at: Date }>(
      "select max(started_at) as started_at from voice_session where enrolment_id = $1", [ruth.enrolmentId]);
    const row = (await overview(ruth.cohortId)).rows.find((r) => r.login === "ruth-adeyemi")!;
    expect(row.lastActivity).toBe(rows[0]!.started_at.toISOString());
  });

  it("counts one stuck pair for each stalled learner, and none for anybody else", async () => {
    const stalled = seeded.people.filter((p) => p.archetype === "stalled").map((p) => p.login);
    const rows = (await Promise.all(cohortIds().map((id) => overview(id)))).flatMap((o) => o.rows);
    expect(stalled.length).toBeGreaterThan(0);
    expect(rows.filter((row) => row.stuck > 0).map((row) => row.login).sort()).toEqual(stalled.sort());
    const total = (await Promise.all(cohortIds().map((id) => overview(id)))).reduce((n, o) => n + o.stuck, 0);
    expect(total).toBe(stalled.length);
  });
});

describe("the Overview's table", () => {
  const row = (login: string, percent: number | null, lastActivity: string | null, stuck = 0) => ({
    enrolmentId: login.length, login, displayName: login, persona: "navigator", state: "active",
    dayReached: null, lastActivity, activeThisWeek: false, stuck,
    readiness: percent === null ? null : { percent, band: "not_ready", clean: 0, passed: 0, attempted: 0, untouched: 0, required: 0 },
  }) as OverviewRow;
  const rows = [row("ann", 40, "2026-10-01T00:00:00Z", 1), row("bo", null, "2026-10-07T00:00:00Z"),
                row("cy", 10, null, 3), row("di", 70, "2026-10-05T00:00:00Z")];
  const order = (sorted: OverviewRow[]) => sorted.map((r) => r.login);

  it("opens newest activity first, with never last", () => {
    expect(order(sortRows(rows, "activity", "desc"))).toEqual(["bo", "di", "ann", "cy"]);
  });

  it("sorts readiness either way and keeps a learner without one last", () => {
    expect(order(sortRows(rows, "readiness", "desc"))).toEqual(["di", "ann", "cy", "bo"]);
    expect(order(sortRows(rows, "readiness", "asc"))).toEqual(["cy", "ann", "di", "bo"]);
  });

  it("sorts by stuck, and ties fall back to the login", () => {
    expect(order(sortRows(rows, "stuck", "desc"))).toEqual(["cy", "ann", "bo", "di"]);
  });

  it("renders a row per learner, with a paused or ended one named so and no readiness", async () => {
    signIn("meera-iyer", "faculty");
    const markup = await html(OverviewPage(query({ sort: "readiness", dir: "asc" })));
    const cohort = await overview(report.accounts.get("meera-iyer")!.cohortId);
    expect(bodyRows(markup)).toBe(cohort.rows.length);
    expect(visible(markup)).toContain("adaeze-eze ended");
    expect(markup).toContain('aria-sort="ascending"');
  });

  it("shows four zero cells and the invite line for a cohort nobody has joined", async () => {
    const { rows: [cohort] } = await db().query<{ id: string }>(
      "insert into cohort (slug, name, starts_on) values ('empty', 'Empty', current_date) returning id");
    session.learner = { enrolmentId: 0, cohortId: Number(cohort!.id), userId: 0, displayName: "admin",
                        role: "admin", persona: "navigator" };
    const markup = await html(OverviewPage(query()));
    // Disagreements open is the Disagreements tab's own count, which covers every cohort, and says so.
    expect(visible(markup)).toMatch(
      /Active in 7 days 0 Submissions this week 0 Stuck 0 Disagreements open, all cohorts \d+/);
    expect(visible(markup)).toContain(
      "Nobody is enrolled in this cohort yet. Invite the first tester from the Roster. Invite a tester");
    expect(markup).toContain('href="/admin/roster#invite"');
  });
});

describe("the other admin screens", () => {
  it("lists the seed's four waiting submissions and four waiting voice answers on Ops", async () => {
    signIn("daniel-osei", "admin");
    const markup = await html(OpsPage());
    const waiting = /<h2 id="waiting"[\s\S]*?<\/section>/.exec(markup)![0];
    const voice = /<h2 id="waiting-voice"[\s\S]*?<\/section>/.exec(markup)![0];
    // docs/11 section 4 gives "stuck" to a learner and problem pair, so Ops says waiting.
    expect(text(markup)).not.toMatch(/\bstuck\b/i);
    expect(bodyRows(waiting)).toBe(4);
    expect(bodyRows(voice)).toBe(4);
    const why = visible(/<tbody[\s\S]*?<\/tbody>/.exec(voice)![0]);
    expect(why.match(/scorer not running|judge gave up/g)!.sort())
      .toEqual(["judge gave up", "judge gave up", "scorer not running", "scorer not running"]);
    const days = /<h2 id="days"[\s\S]*?<\/section>/.exec(markup)![0];
    expect(bodyRows(days)).toBe(7);
  });

  it("titles every tab with its h1", async () => {
    signIn("daniel-osei", "admin");
    const pages: Array<[unknown, Promise<ReactElement>]> = [
      [overviewMeta.title, OverviewPage(query())],
      [rosterMeta.title, RosterPage()],
      [submissionsMeta.title, SubmissionsPage(query())],
      [disagreementsMeta.title, DisagreementsPage(query())],
      [opsMeta.title, OpsPage()],
      [importMeta.title, ImportPage()],
      [cohortMeta.title, CohortPage()],
      [calibrationMeta.title, CalibrationPage()],
      [panelMeta.title, PanelPage()],
    ];
    for (const [title, page] of pages) expect(h1(await html(page))).toBe(title);

    signIn("meera-iyer", "faculty");
    const priya = report.accounts.get("priya-raghavan")!.enrolmentId;
    expect((await generateMetadata(params(priya))).title).toBe(h1(await html(LearnerPage(params(priya)))));
  });

  it("shows faculty the roster with no buttons, and an admin both actions", async () => {
    signIn("meera-iyer", "faculty");
    const faculty = await html(RosterPage());
    expect(faculty).not.toContain("<button");
    expect(text(faculty)).not.toContain("Invites");

    signIn("daniel-osei", "admin");
    const admin = visible(await html(RosterPage()));
    expect(admin).toContain("Roster Change personas from a CSV Invite a tester");
  });

  it("falls back to no filter on a date that is not one", async () => {
    signIn("daniel-osei", "admin");
    const all = visible(await html(SubmissionsPage(query())));
    const bad = visible(await html(SubmissionsPage(query({ since: "2026-02-30" }))));
    expect(bad).toBe(all);
  });

  it("says the Submissions list is cut at one page, and counts every row when they all fit", async () => {
    signIn("daniel-osei", "admin");
    const { rows: [all] } = await db().query<{ n: number }>("select count(*)::int as n from submission");
    expect(all!.n).toBeGreaterThan(50);
    expect(visible(await html(SubmissionsPage(query()))))
      .toContain(`First 50 of ${all!.n} submissions, newest first. Filter to narrow.`);
    expect(visible(await html(SubmissionsPage(query({ page: "2" })))))
      .toContain(`51 to ${Math.min(100, all!.n)} of ${all!.n} submissions, newest first.`);

    const { rows: [few] } = await db().query<{ login: string; n: number }>(
      `select u.github_login as login, count(*)::int as n
         from submission s join attempt a on a.id = s.attempt_id
         join enrolment e on e.id = a.enrolment_id join app_user u on u.id = e.user_id
        group by u.github_login having count(*) between 2 and 50 order by 1 limit 1`);
    expect(visible(await html(SubmissionsPage(query({ login: few!.login })))))
      .toContain(`${few!.n} submissions When Learner`);
  });

  it("says which empty state it is in by whether a filter is set", async () => {
    signIn("daniel-osei", "admin");
    const none = visible(await html(SubmissionsPage(query({ login: "nobody-at-all" }))));
    expect(none).toContain("No submission matches. Clear a filter, or widen the date. Clear filters");
  });
});

describe("every admin control is a primitive", () => {
  async function files(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    return (await Promise.all(entries.map((entry) => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? files(full) : Promise.resolve(/\.tsx?$/.test(entry.name) ? [full] : []);
    }))).flat();
  }
  const ADMIN = path.join(import.meta.dirname, "..", "app", "(shell)", "admin");

  it("draws no native input, select, textarea or button under app/(shell)/admin", async () => {
    for (const file of await files(ADMIN)) {
      const source = await readFile(file, "utf8");
      expect(source.match(/<(input|select|textarea|button)\b/g), path.relative(ADMIN, file)).toBeNull();
    }
  });

  it("asks nothing through prompt, confirm or alert anywhere under app", async () => {
    const app = path.join(ADMIN, "..", "..");
    for (const file of await files(app)) {
      const source = await readFile(file, "utf8");
      expect(source.match(/\b(prompt|confirm|alert)\s*\(/g), path.relative(app, file)).toBeNull();
    }
  });
});
