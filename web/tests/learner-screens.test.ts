/**
 * Step 3 of the redesign, story S17.3: the learner screens at S1 and S2.
 *
 * Each screen is rendered the way Next renders a server component, by
 * awaiting the page and rendering what it returns, against fixtures imported
 * here. The checks are the brief's: one position and one next action per
 * screen, every empty state naming its action, and no environment variable
 * name on any screen.
 */
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The rehearsal Start button asks for the router, which only a running app
// has. Nothing here navigates.
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ push: () => undefined }),
}));

import { closeDb, db } from "../lib/db/pool.ts";
import { createInvite } from "../lib/auth/invite.ts";
import { listProblems, nearestWithProblems } from "../lib/problems/catalogue.ts";
import { seedTracks, type RoadmapItem } from "../lib/policy/roadmap.ts";
import { DURATION_MINUTES, PROBLEM_COUNT } from "../lib/rehearsal/index.ts";
import { audioState, scoreState } from "../lib/voice/debrief.ts";
import { AttemptsPanel } from "../components/workspace/panels.tsx";
import { PositionStrip } from "../components/home/sections.tsx";
import SignInPage from "../app/signin/page.tsx";
import InvitePage from "../app/invite/[token]/page.tsx";
import HomePage from "../app/(shell)/page.tsx";
import ProblemsPage from "../app/(shell)/problems/page.tsx";
import ChapterPage from "../app/(shell)/chapters/[chapter]/page.tsx";
import VoicePage from "../app/(shell)/voice/page.tsx";
import PastSessionsPage from "../app/(shell)/voice/sessions/page.tsx";
import ProgressPage from "../app/(shell)/progress/page.tsx";
import RehearsalPage from "../app/(shell)/rehearsal/page.tsx";
import { importFixtures, resetDatabase, seedLearner } from "./helpers.ts";

const html = async (page: ReactElement | Promise<ReactElement>) => renderToStaticMarkup(await page);
/** What a reader sees: tags become spaces, except before the punctuation that follows a link. */
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/&#x27;|&apos;/g, "'")
  .replace(/&amp;/g, "&").replace(/\s+/g, " ").replace(/ ([.,;:?!])/g, "$1").trim();
const words = (markup: string) => text(markup).split(" ").filter(Boolean).length;
const params = <T,>(value: T) => ({ params: Promise.resolve(value) });
const query = (value: Record<string, string> = {}) => ({ searchParams: Promise.resolve(value) });
/** The visible text of a page's main region, minus every table in it. */
const outsideTables = (markup: string) => text(markup.replace(/<table[\s\S]*?<\/table>/g, ""));

const ENV_NAMES = /GITHUB_CLIENT_ID|GITHUB_CLIENT_SECRET|AUTH_SECRET|AUTH_DEV_LEARNER|VOICE_SOCKET_URL|VOICE_TOKEN_SECRET/;
/** The shell header reads 15 words for staff and 14 for a learner, and is not part of a page. */
const HEADER_WORDS = 15;

let learner: { enrolmentId: number; cohortId: number; userId: number };
/** The variables these tests set or clear, put back after each one. */
const saved = { GITHUB_CLIENT_ID: process.env["GITHUB_CLIENT_ID"],
                VOICE_SOCKET_URL: process.env["VOICE_SOCKET_URL"] };

beforeEach(async () => {
  await resetDatabase();
  await importFixtures();
  await seedTracks();
  // The first enrolment is the one the development learner resolves to.
  learner = await seedLearner({ persona: "navigator", githubId: 7 });
});

afterEach(() => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  vi.restoreAllMocks();
});

afterAll(async () => {
  await closeDb();
});

async function attempt(slug: string, solved = false): Promise<void> {
  await db().query(
    `insert into attempt (enrolment_id, cohort_id, problem_id, solved_at)
     select $1, $4, id, case when $3 then now() end from problem where slug = $2`,
    [learner.enrolmentId, slug, solved, learner.cohortId]);
}

describe("S1: sign-in and the invite page", () => {
  // First in the file, so the log line has not been written yet in this process.
  it("names no variable on screen when sign-in is not set up, and logs them once", async () => {
    delete process.env["GITHUB_CLIENT_ID"];
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const first = await html(SignInPage(query()));
    await html(SignInPage(query()));

    expect(text(first)).toContain(
      "Sign-in is not set up on this deployment. Contact your programme manager.");
    expect(first).not.toMatch(ENV_NAMES);
    expect(first).not.toContain("<a ");
    expect(logged).toHaveBeenCalledTimes(1);
    expect(String(logged.mock.calls[0]![0])).toMatch(/GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET and AUTH_SECRET/);
  });

  it("reads under forty words, with GitHub the only thing to press", async () => {
    process.env["GITHUB_CLIENT_ID"] = "an-application";
    const markup = await html(SignInPage(query()));
    expect(words(markup)).toBeLessThan(40);
    expect(text(markup)).toBe("FDE Prep Sign in to FDE Prep Access is granted through your FDE Academy " +
      "GitHub account. Continue with GitHub Trouble signing in? Contact your programme manager.");
    expect(markup.match(/<a /g)).toHaveLength(1);
    expect(markup).toContain('href="/api/auth/start"');
  });

  it("puts a refusal in the fail panel and signing out in a plain one, above the button", async () => {
    process.env["GITHUB_CLIENT_ID"] = "an-application";
    const refused = await html(SignInPage(query({ error: "not_enrolled" })));
    expect(refused).toMatch(/role="status" class="[^"]*bg-fail-soft[^"]*">Your account is not enrolled in an active cohort\./);
    expect(refused.indexOf('role="status"')).toBeLessThan(refused.indexOf("Continue with GitHub"));

    const out = await html(SignInPage(query({ error: "signed_out" })));
    expect(out).toMatch(/role="status" class="[^"]*bg-surface[^"]*">You are signed out\./);
    expect(out).not.toContain("bg-fail-soft");
  });

  it("opens an invite with one line and the GitHub button, and names nothing when sign-in is off", async () => {
    const { token } = await createInvite({ cohortId: learner.cohortId, actorId: null });
    process.env["GITHUB_CLIENT_ID"] = "an-application";
    const open = await html(InvitePage(params({ token })));
    expect(text(open)).toContain("You are invited to FDE Prep Sign in with GitHub to accept. The link " +
      "works once, for the first account that uses it. Continue with GitHub");
    expect(open).toContain(`href="/api/auth/start?invite=${token}"`);

    delete process.env["GITHUB_CLIENT_ID"];
    const off = await html(InvitePage(params({ token })));
    expect(text(off)).toContain("Sign-in is not set up on this deployment. Contact whoever sent the invite.");
    expect(off).not.toMatch(ENV_NAMES);
  });

  it("refuses a dead link and points an enrolled learner at sign-in", async () => {
    const markup = await html(InvitePage(params({ token: "not-a-token" })));
    expect(text(markup)).toContain("This invite cannot be used That invite link is no longer valid. " +
      "Ask whoever sent it for a new one. Already enrolled? Sign in.");
    expect(markup).toContain('href="/signin"');
  });
});

describe("S2: Home", () => {
  it("opens a new learner on the position, the first problem on the path and readiness", async () => {
    const markup = await html(HomePage());
    const first = (await listProblems({ enrolmentId: learner.enrolmentId, sort: "roadmap" })).rows[0]!;

    // Acceptance 4: the start card and the first row of Problems in path order are one problem.
    expect(markup).toContain(`href="/problems/${first.slug}"`);
    expect(markup.match(/href="\/problems\//g)).toHaveLength(1);
    expect(text(markup)).toContain("Track Agentic AI for FDEs Persona Navigator");
    expect(text(markup)).toContain("Your first problem");
    expect(text(markup)).toContain("Open the problem");
    expect(text(markup)).toContain("Readiness Full heatmap 0% Not ready Clean 0 Passed 0 Attempted 0 Untouched");
    expect(text(markup)).not.toMatch(/Next up|Recent activity|Welcome/);
    expect(words(markup) + HEADER_WORDS).toBeLessThan(120);
  });

  it("says a run has not finished yet without offering a button", async () => {
    await attempt("carry-state-across-turns");
    const markup = await html(HomePage());
    const recent = markup.slice(markup.indexOf('id="recent"'));

    expect(text(markup)).toContain("Next up Pick up where you left off");
    expect(markup.match(/aria-label="Open [^"]+"/g)).toHaveLength(3);
    expect(text(recent)).toContain("Nothing finished yet. The run you started lands here with its result.");
    expect(recent.slice(recent.indexOf("Nothing finished"))).not.toMatch(/<a |<button/);
  });

  it("sends a learner who has passed the whole path to a rehearsal", async () => {
    const { rows } = await db().query<{ slug: string }>("select slug from problem");
    for (const { slug } of rows) await attempt(slug, true);
    const markup = await html(HomePage());

    expect(text(markup)).toContain("Day Path complete");
    expect(text(markup)).toContain("Every problem on your path is passed Sit a rehearsal");
    expect(markup).toContain('href="/rehearsal"');
    expect(text(markup)).toContain("Readiness");
  });

  it("names the earliest storyline day still open, so solving a later day never steps it back", () => {
    const item = (day: number | null, solved = false, isOptional = false): RoadmapItem => ({
      problemId: 0, slug: "a-problem", title: "A problem", difficulty: "easy", track: "loop",
      artefactType: "code", estMinutes: 15, competencyCount: 1, day, topic: null, ordinal: 0,
      isOptional, solved, attempted: solved,
    });
    const strip = (items: RoadmapItem[]) => text(renderToStaticMarkup(createElement(PositionStrip, {
      roadmap: { persona: "builder", trackName: "Foundations for FDEs", items, solved: 0,
                 total: items.length, optionalUnlocked: false },
    })));

    // The builder path opens on a day 2 problem ahead of the day 1 problems.
    expect(strip([item(2), item(1), item(1)])).toContain("Day Day 1 of 30");
    expect(strip([item(2, true), item(1), item(1)])).toContain("Day Day 1 of 30");
    expect(strip([item(2), item(1, true), item(1, true)])).toContain("Day Day 2 of 30");
    // An optional problem does not hold the day back, and a required one with no day names none.
    expect(strip([item(1, false, true), item(3)])).toContain("Day Day 3 of 30");
    expect(strip([item(null), item(2, true)])).not.toContain("Day");
    expect(strip([item(1, true), item(4, false, true)])).toContain("Day Path complete");
  });
});

describe("Problems", () => {
  it("opens on the chapter map, fourteen rows, each to its chapter page", async () => {
    const markup = await html(ProblemsPage(query()));
    expect(markup.match(/href="\/chapters\/[a-z-]+"/g)).toHaveLength(14);
    // Harness engineering has no fixture problem, and still links to its page.
    expect(text(markup)).toContain("Harness engineering No problems yet");
    expect(text(markup)).toContain("Loop engineering 0 of 5 solved");
  });

  it("drops the map once a filter, a search or a sort is set", async () => {
    const sets: Array<Record<string, string>> = [{ difficulty: "hard" }, { q: "loop" }, { sort: "storyline" }];
    for (const set of sets) {
      expect(await html(ProblemsPage(query(set)))).not.toContain('href="/chapters/');
    }
  });

  it("leads with the day only under The 30 days, and shows no solve-rate placeholder", async () => {
    await db().query("update problem set day = 4 where slug = 'retry-once-then-degrade'");
    const storyline = text(await html(ProblemsPage(query({ sort: "storyline" }))));
    expect(storyline).toContain("Day 4 Retry once then degrade");
    const path = text(await html(ProblemsPage(query())));
    expect(path).not.toContain("Day 4 Retry");
    expect(path).toMatch(/Day 4 Medium/);
    expect(path).not.toMatch(/Solve rate hidden|No attempts yet/);
  });

  it("keeps the no-match sentence and its button", async () => {
    const markup = await html(ProblemsPage(query({ q: "zzzzqq" })));
    expect(text(markup)).toContain(
      "No problem matches these filters. Clear one, or search for a chapter name. Show every problem");
  });
});

describe("a chapter with no problems", () => {
  it("names the nearest chapter with problems and opens it", async () => {
    const markup = await html(ChapterPage(params({ chapter: "harness" })));
    expect(text(markup)).toContain("This chapter's problems are still being written. The nearest " +
      "chapter with problems is Tool design. Open Tool design");
    expect(markup).toContain('href="/chapters/tools"');
  });

  it("prefers the earlier of two chapters as close", () => {
    expect(nearestWithProblems("agentic-sdlc", ["agentic-pdlc", "builds"])).toBe("agentic-pdlc");
    expect(nearestWithProblems("agentic-sdlc", ["evals", "fde-practice"])).toBe("fde-practice");
    expect(nearestWithProblems("loop", [])).toBeNull();
  });
});

describe("the workspace's Attempts tab", () => {
  it("names Run and its shortcut, with no button of its own", async () => {
    const markup = await html(createElement(AttemptsPanel, { submissions: [] }));
    expect(text(markup)).toBe("Nothing run yet. Press Run, or Cmd Enter, to send your code through the " +
      "public tests. Every run and submit lands here with its result and a replay.");
    expect(markup).not.toContain("<button");
  });
});

describe("Voice", () => {
  it("says spoken answers are off and the catalogue is empty, naming no variable and no command", async () => {
    delete process.env["VOICE_SOCKET_URL"];
    await db().query("update enrolment set role = 'admin' where id = $1", [learner.enrolmentId]);
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const markup = await html(VoicePage());

    expect(text(markup)).toContain("Spoken answers are not switched on for this cohort yet, so a spoken " +
      "run is timed practice and only a typed answer is scored.");
    expect(text(markup)).toContain(
      "No interview questions are published yet. Ask your faculty to run the content import.");
    expect(markup).not.toMatch(ENV_NAMES);
    expect(markup).not.toContain("npm");
    const lines = logged.mock.calls.map((call) => String(call[0]));
    expect(lines.some((line) => /VOICE_SOCKET_URL and VOICE_TOKEN_SECRET/.test(line))).toBe(true);
    expect(lines.some((line) => /npm run import:content/.test(line))).toBe(true);
  });

  it("lists every question in one table with Answer as its only button", async () => {
    const { importVoiceQuestion } = await import("../lib/voice/import.ts");
    const { readFile, readdir } = await import("node:fs/promises");
    const path = await import("node:path");
    const root = path.join(import.meta.dirname, "..", "..", "voice-questions");
    let count = 0;
    for (const track of await readdir(root)) {
      for (const file of await readdir(path.join(root, track))) {
        await importVoiceQuestion(await readFile(path.join(root, track, file), "utf8"), file);
        count += 1;
      }
    }
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const markup = await html(VoicePage());

    expect(markup.match(/<table/g)).toHaveLength(1);
    expect(markup.match(/aria-label="Answer [^"]+"/g)).toHaveLength(count);
    expect(markup).not.toContain("<button");
    // S13.4 added two filter rows, by interviewer and by competency. They are
    // navigation, links only, so the prose budget is counted without them.
    const filters = markup.match(/<nav aria-label="Filter the questions"[\s\S]*?<\/nav>/)?.[0] ?? "";
    expect(filters.match(/<a /g)?.length ?? 0).toBeGreaterThan(0);
    expect(outsideTables(markup.replace(filters, "")).split(" ").length).toBeLessThan(40);
  });
});

describe("Past answers", () => {
  const now = new Date("2026-10-08T12:00:00Z");
  const base = { score: null, notCounted: false, judgeGaveUp: false };
  const finished = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000).toISOString();

  it("reads each of the five score states", () => {
    expect(scoreState({ ...base, score: 72, finishedAt: finished(5) }, now)).toBe("scored");
    expect(scoreState({ ...base, notCounted: true, finishedAt: finished(5) }, now)).toBe("not_counted");
    expect(scoreState({ ...base, finishedAt: finished(59) }, now)).toBe("scoring");
    expect(scoreState({ ...base, finishedAt: finished(61) }, now)).toBe("late");
    expect(scoreState({ ...base, judgeGaveUp: true, finishedAt: finished(5) }, now)).toBe("gave_up");
  });

  it("says None for a recording never stored, and tells the retention sweep from a learner's delete", () => {
    const answer = { input: "spoken" as const, hasAudio: false, finishedAt: "2026-09-01T10:00:00Z" };
    expect(audioState({ ...answer, input: "typed", audioDeletedAt: null })).toBe("typed");
    expect(audioState({ ...answer, hasAudio: true, audioDeletedAt: null })).toBe("kept");
    expect(audioState({ ...answer, audioDeletedAt: null })).toBe("none");
    expect(audioState({ ...answer, audioDeletedAt: "2026-10-01T10:00:00Z" })).toBe("expired");
    expect(audioState({ ...answer, audioDeletedAt: "2026-09-02T10:00:00Z" })).toBe("deleted");
  });

  it("keeps its empty state, whose button is the page's one way to Voice", async () => {
    const markup = await html(PastSessionsPage());
    expect(text(markup)).toContain("You have not finished an answer yet. Pick a question; each one runs " +
      "two to three minutes. Answer a question");
    expect(markup.match(/href="\/voice"/g)).toHaveLength(1);
  });
});

describe("Progress", () => {
  it("opens on readiness at zero and offers one way to the path", async () => {
    const markup = await html(ProgressPage());

    expect(text(markup)).toContain("Readiness 0% Not ready Clean 0 Passed 0 Attempted 0 Untouched");
    expect(text(markup)).toContain("Every cell is empty. Pass a problem with no hints and inside its call " +
      "budget, and its competencies fill in here. Open your path");
    expect(text(markup)).toContain(
      "Attempt history Nothing attempted yet. Your first problem is waiting at the top of your path.");
    expect(markup.match(/Open your path/g)).toHaveLength(1);
    expect(text(markup)).not.toContain("Thirteen competencies");
  });
});

describe("Rehearsal", () => {
  it("names the Start button in its empty state, which sits on the same page", async () => {
    const markup = await html(RehearsalPage());
    expect(text(markup)).toContain("No sittings yet. Press Start a rehearsal when you can give it " +
      `${DURATION_MINUTES} uninterrupted minutes.`);
    expect(text(markup)).toContain("Start a rehearsal");
    // The line under the h1 says three problems and sixty minutes in words.
    expect({ PROBLEM_COUNT, DURATION_MINUTES }).toEqual({ PROBLEM_COUNT: 3, DURATION_MINUTES: 60 });
    expect(words(markup) + HEADER_WORDS).toBeLessThan(90);
  });
});
