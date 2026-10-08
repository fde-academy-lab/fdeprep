/**
 * npm run db:seed at the test plan's scale: six learners over fourteen days,
 * every archetype among them. Bolt 7 of the seed brief.
 *
 * The seed writes through the production paths, so what is checked here is
 * that those paths produced what the plan promised, and that the rule the
 * step exists to keep held: eval/ wrote every grade. The hand-computed
 * readiness in tests/fixtures/seed-readiness.ts is the docs/06 Phase 5 test
 * shape, applied to the seed.
 */
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { roster } from "../lib/admin/index.ts";
import { opsSnapshot } from "../lib/admin/ops.ts";
import { closeDb, db } from "../lib/db/pool.ts";
import { disagreementQueue } from "../lib/eval/review.ts";
import { seedTracks } from "../lib/policy/roadmap.ts";
import { heatmap } from "../lib/progress/index.ts";
import { readinessFor } from "../lib/progress/readiness.ts";
import { loadCatalogue } from "../lib/seed/catalogue.ts";
import { plan, type AttemptAction, type SeedPlan } from "../lib/seed/plan.ts";
import { removeSeed } from "../lib/seed/replace.ts";
import { runSeed, SeedRefused, type SeedReport } from "../lib/seed/run.ts";
import { learnerOrNull } from "../lib/session/current.ts";
import { importVoiceQuestion } from "../lib/voice/import.ts";
import { NAMED, type Step } from "./fixtures/seed-readiness.ts";
import { importFixtures, resetDatabase } from "./helpers.ts";
import { seedCommand } from "../scripts/seed.ts";

const VOICE = path.join(import.meta.dirname, "..", "..", "voice-questions");
const QUESTIONS = [
  "agent-loop/stop-an-agent-that-never-finishes.yaml",
  "client-communication/say-no-to-the-date.yaml",
  "tool-schema-design/retry-a-tool-that-may-have-acted.yaml",
];

let seeded: SeedPlan;
let report: SeedReport;
let embedDir: string | undefined;

beforeAll(async () => {
  // A host with the embedding model would run panelist 2 inside writeResult.
  // The seed never depends on it, and this keeps the test the same on every
  // host: no weights in this directory, so panelist 2 reports an absence.
  embedDir = process.env["FDEPREP_EMBED_MODEL_DIR"];
  process.env["FDEPREP_EMBED_MODEL_DIR"] = await mkdtemp(path.join(tmpdir(), "fdeprep-seed-"));

  await resetDatabase();
  await importFixtures();
  for (const file of QUESTIONS) {
    await importVoiceQuestion(await readFile(path.join(VOICE, file), "utf8"), file);
  }
  await seedTracks();
  // Anchored to a fixed day so the plan, and the fixture worked out from it,
  // never move. The seed itself places every day against the real clock.
  seeded = plan({ today: "2026-10-08", catalogue: await loadCatalogue(), scale: "test" });
  report = await runSeed(seeded);
}, 240_000);

afterAll(async () => {
  if (embedDir === undefined) delete process.env["FDEPREP_EMBED_MODEL_DIR"];
  else process.env["FDEPREP_EMBED_MODEL_DIR"] = embedDir;
  await closeDb();
});

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await db().query<{ n: string }>(sql, params);
  return Number(rows[0]!.n);
}

function enrolment(login: string): number {
  return report.accounts.get(login)!.enrolmentId;
}

describe("the test plan covers every path the seed takes", () => {
  it("plans every outcome, the refused retry, a stuck learner and every voice mode", () => {
    const actions = seeded.sittings.flatMap((s) => s.actions.map((a) => ({ ...a, login: s.login })));
    const attempts = actions.filter((a): a is AttemptAction & { login: string } => a.type === "attempt");
    expect(new Set(attempts.map((a) => a.outcome)))
      .toEqual(new Set(["clean", "hinted", "over_budget", "fail", "error", "timeout"]));
    expect(seeded.expected.refusedRetries).toBe(1);
    expect(attempts.some((a) => a.defence !== undefined)).toBe(true);
    expect(attempts.some((a) => a.learnerTest)).toBe(true);

    const fails = new Map<string, number>();
    for (const a of attempts.filter((x) => x.outcome === "fail")) {
      fails.set(`${a.login}:${a.slug}`, (fails.get(`${a.login}:${a.slug}`) ?? 0) + 1);
    }
    expect(Math.max(...fails.values())).toBeGreaterThanOrEqual(3);

    const voice = actions.filter((a) => a.type === "voice");
    expect(voice.some((v) => v.mode === "pressure")).toBe(true);
    expect(voice.some((v) => v.input === "typed")).toBe(true);
    expect(voice.some((v) => v.short)).toBe(true);
    expect(seeded.expected.disagreements).toEqual({ open: 1, upheld: 1, overridden: 1 });
  });
});

describe("the rows the plan promised", () => {
  it("writes each of them", async () => {
    const e = seeded.expected;
    expect(await count("select count(*) as n from submission")).toBe(e.submissions);
    expect(await count("select count(*) as n from voice_session")).toBe(e.voiceSessions);
    expect(await count("select count(*) as n from rehearsal")).toBe(e.rehearsals);
    expect(await count("select count(*) as n from rehearsal where finished_at is null"))
      .toBe(e.unfinishedRehearsals);
    expect(await count("select count(*) as n from voice_consent")).toBe(e.consents);
    expect(await count("select count(*) as n from persona_change")).toBe(e.personaChanges);
    expect(await count("select count(*) as n from evaluation_review")).toBe(
      e.disagreements.upheld + e.disagreements.overridden);
    // The forty people, cut to the test plan, and the development account.
    expect(await count("select count(*) as n from enrolment")).toBe(e.people + 1);
  });

  it("leaves invites in every state, written by the invite paths", async () => {
    const { rows } = await db().query<{ state: string; n: string }>(
      `select case when used_at is not null then 'used'
                   when revoked_at is not null then 'withdrawn'
                   when expires_at <= now() then 'expired' else 'pending' end as state,
              count(*) as n
         from invite group by 1`);
    expect(Object.fromEntries(rows.map((r) => [r.state, Number(r.n)])))
      .toEqual(seeded.expected.invites);
    const audit = await db().query<{ action: string; n: string }>(
      "select action, count(*) as n from audit_log group by action order by action");
    const actions = Object.fromEntries(audit.rows.map((r) => [r.action, Number(r.n)]));
    expect(actions).toMatchObject({
      invite_created: 6, invite_revoked: 1, invite_redeemed: 2,
      "persona.change": 1, "platform.degraded_mode": 2, "cap.clear": 1,
      "evaluation.review": 2, "evaluation.override": 1,
    });
  });

  it("leaves degraded mode off after turning it on and off with a reason", async () => {
    const { rows } = await db().query<{ value: unknown }>(
      "select value from platform_setting where key = 'degraded_mode'");
    expect(rows[0]!.value).toBe(false);
  });

  it("signs the development learner in as an admin in seed-c3", async () => {
    const learner = await learnerOrNull();
    expect(learner?.role).toBe("admin");
    expect(learner?.cohortId).toBe(report.cohorts.get("c3"));
  });
});

describe("readiness for the three named learners", () => {
  function historyOf(login: string): Step[] {
    return seeded.sittings.filter((s) => s.login === login).flatMap((s) => s.actions.flatMap((a): Step[] => {
      if (a.type === "attempt") {
        return [{ daysAgo: s.daysAgo, slug: a.slug, kind: "attempt" as const, outcome: a.outcome,
                  runs: a.runs, hints: a.hints }];
      }
      if (a.type === "rehearsal") {
        return a.submits.map((submit) => ({ daysAgo: s.daysAgo, slug: submit.slug,
          kind: "rehearsal" as const, outcome: submit.outcome, runs: 0, hints: 0 }));
      }
      return [];
    }));
  }

  it("comes from the history the fixture was worked out from", () => {
    for (const learner of NAMED) expect(historyOf(learner.login)).toEqual(learner.history);
  });

  it("equals the hand-computed fixture", async () => {
    for (const learner of NAMED) {
      expect(await readinessFor(enrolment(learner.login))).toEqual(learner.expected);
    }
  });

  it("agrees with the heatmap's clean cells where the two overlap", async () => {
    for (const learner of NAMED) {
      const grid = await heatmap(enrolment(learner.login));
      const clean = grid.rows.flatMap((row) => row.cells
        .filter((cell) => cell.state === "clean")
        .map((cell) => `${row.slug}/${cell.difficulty}`));
      expect(clean).toEqual(expect.arrayContaining(learner.cleanCells));
      expect(learner.cleanCells).toHaveLength(learner.expected.clean);
    }
  });
});

describe("eval/ wrote every grade", () => {
  it("gives every evaluation a submission whose verdict it matches", async () => {
    expect(await count(
      `select count(*) as n from evaluation e join submission s on s.id = e.submission_id
        where not ((e.verdict is null and s.verdict in ('error', 'timeout'))
                   or e.verdict = s.verdict)`)).toBe(0);
    expect(await count(
      `select count(*) as n from submission s
        where s.verdict is not null
          and not exists (select 1 from evaluation e where e.submission_id = s.id)`)).toBe(0);
  });

  it("backs every competency cell with an earned submission", async () => {
    expect(await count("select count(*) as n from competency_score")).toBeGreaterThan(0);
    expect(await count(
      `select count(*) as n from competency_score cs
        where not exists (
          select 1 from submission s
            join attempt a on a.id = s.attempt_id
            join problem p on p.id = a.problem_id
            join problem_competency pc on pc.problem_id = p.id
           where a.enrolment_id = cs.enrolment_id and pc.competency_id = cs.competency_id
             and p.difficulty = cs.difficulty and s.verdict in ('pass', 'fail'))`)).toBe(0);
  });

  it("ran panelist 2 only where the seed scripted a panel, never inside writeResult", async () => {
    expect(await count(
      `select count(*) as n from evaluation e, jsonb_array_elements(e.panel) seat
        where seat->>'panelist' = 'pretrained' and seat->>'status' = 'ran'
          and e.disagreement is null and e.overridden_by is null`)).toBe(0);
  });

  it("leaves every counter equal to the claims that stood, so each error gave its unit back", async () => {
    // A run spends run_hourly and a submit spends submit_daily on its
    // problem. A claim belongs to the latest window for its learner, scope
    // and problem that opened at or before it, which is the window an error
    // is refunded to, so a window's count is the claims it owns that were not
    // refunded. Each simulated day opens fresh windows, so the next window is
    // where one stops owning claims. This plan has no error on a problem with
    // an earlier window; tests/pipeline.test.ts pins that case.
    expect(await count(
      "select count(*) as n from submission where verdict in ('error', 'timeout')"))
      .toBeGreaterThan(0);
    const { rows } = await db().query<{ id: string; count: number; standing: number }>(
      `select c.id, c.count,
              (select count(*)::int from submission s
                 join attempt a on a.id = s.attempt_id
                where a.enrolment_id = c.enrolment_id and a.problem_id = c.problem_id
                  and s.kind = (case c.scope when 'run_hourly' then 'run'
                                             else 'submit' end)::run_kind
                  and s.queued_at >= c.window_start
                  and s.queued_at < coalesce(
                        (select min(later.window_start) from rate_limit_counter later
                          where later.enrolment_id = c.enrolment_id and later.scope = c.scope
                            and later.problem_id = c.problem_id
                            and later.window_start > c.window_start), 'infinity')
                  and (s.verdict is null or s.verdict not in ('error', 'timeout'))) as standing
         from rate_limit_counter c
        where c.scope in ('run_hourly', 'submit_daily')`);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((r) => r.count !== r.standing)).toEqual([]);
  });
});

describe("what the admin screens read", () => {
  it("shows a voice-only learner's last activity as their latest answer", async () => {
    expect(await count(
      `select count(*) as n from submission s join attempt a on a.id = s.attempt_id
        where a.enrolment_id = $1`, [enrolment("ruth-adeyemi")])).toBe(0);
    const { rows } = await db().query<{ started_at: Date }>(
      "select max(started_at) as started_at from voice_session where enrolment_id = $1",
      [enrolment("ruth-adeyemi")]);
    const row = (await roster(report.cohorts.get("c4")!)).find((r) => r.login === "ruth-adeyemi")!;
    expect(row.lastActivity).toBe(rows[0]!.started_at.toISOString());
  });

  it("lists four stuck submissions and four stuck voice answers on Ops", async () => {
    const snapshot = await opsSnapshot();
    // Oldest first. Waiting is read when Ops is, so allow the minute the test took.
    const waiting = snapshot.stuck.map((row) => row.waitingMinutes);
    expect(waiting).toHaveLength(4);
    [2880, 180, 40, 7].forEach((minutes, i) => expect(Math.abs(waiting[i]! - minutes)).toBeLessThanOrEqual(1));
    expect(snapshot.stuckVoice.map((row) => row.why).sort()).toEqual(
      ["judge_gave_up", "judge_gave_up", "scorer_not_running", "scorer_not_running"]);
    expect(snapshot.degraded.on).toBe(false);
  });

  it("holds the planned disagreements, and the corrected one is gone from the queue", async () => {
    const open = await disagreementQueue({ disposition: "open" });
    const planned = seeded.disagreements.filter((d) => !d.review);
    expect(open.rows.map((r) => [r.login, r.slug])).toEqual(planned.map((d) => [d.login, d.slug]));
    expect(open.open).toBe(seeded.expected.disagreements.open);
    expect((await disagreementQueue({ disposition: "upheld" })).rows)
      .toHaveLength(seeded.expected.disagreements.upheld);
    expect((await disagreementQueue({ disposition: "disputed" })).rows).toHaveLength(0);

    const corrected = seeded.disagreements.find((d) => d.override)!;
    const { rows } = await db().query<{ band: string; overridden_by: string | null }>(
      `select e.band, e.overridden_by from evaluation e
         join submission s on s.id = e.submission_id
         join attempt a on a.id = s.attempt_id
         join problem p on p.id = a.problem_id
        where a.enrolment_id = $1 and p.slug = $2 and s.kind = 'submit'
        order by e.created_at desc, e.id desc limit 1`,
      [enrolment(corrected.login), corrected.slug]);
    expect(rows[0]!.band).toBe("strong");
    expect(Number(rows[0]!.overridden_by)).toBe(report.accounts.get(seeded.faculty)!.userId);
  });
});

describe("the seed refuses to grade somebody else's work", () => {
  it("stops when a voice answer it did not write is waiting for the scorer", async () => {
    const ruth = report.accounts.get("ruth-adeyemi")!;
    const { rows } = await db().query<{ id: string }>(
      `insert into voice_session
         (enrolment_id, voice_question_id, cohort_id, mode, input, finished_at, transcript)
       select $1, id, $2, 'guided', 'typed', now(), 'not the seed''s answer'
         from voice_question limit 1 returning id`, [ruth.enrolmentId, ruth.cohortId]);
    try {
      await expect(runSeed(seeded)).rejects.toBeInstanceOf(SeedRefused);
    } finally {
      await db().query("delete from voice_session where id = $1", [rows[0]!.id]);
    }
  });
});

describe("npm run db:seed refuses before it writes", () => {
  async function run(argv: string[]): Promise<{ code: number; said: string }> {
    const lines: string[] = [];
    const code = await seedCommand(argv, (line) => lines.push(line));
    return { code, said: lines.join("\n") };
  }

  it("refuses a second seed and names --replace", async () => {
    const { code, said } = await run([]);
    expect(code).toBe(1);
    expect(said).toMatch(/--replace/);
  });

  it("refuses a production database without --yes, saying what it would write", async () => {
    const env = process.env as Record<string, string | undefined>;
    const previous = env["NODE_ENV"];
    env["NODE_ENV"] = "production";
    try {
      const { code, said } = await run(["--replace"]);
      expect(code).toBe(1);
      expect(said).toMatch(/--yes/);
      expect(said).toMatch(/forty seeded learners/);
    } finally {
      env["NODE_ENV"] = previous;
    }
  });

  it("refuses an empty catalogue and says to import first", async () => {
    await db().query("update problem set is_published = false");
    try {
      const { code, said } = await run([]);
      expect(code).toBe(1);
      expect(said).toBe(
        "No problems are published. Run npm run import:content first, then npm run db:seed.");
    } finally {
      await db().query("update problem set is_published = true");
    }
  });
});

describe("--replace", () => {
  it("removes the seed and nothing else, and the seed runs again", async () => {
    const before = {
      problems: await count("select count(*) as n from problem"),
      users: await count("select count(*) as n from app_user"),
    };

    expect(await removeSeed()).toBe(2);

    for (const table of ["cohort", "enrolment", "submission", "evaluation", "evaluation_review",
                         "competency_score", "attempt", "invite", "voice_session", "rehearsal",
                         "rate_limit_counter", "persona_change", "audit_log", "outbox"]) {
      expect(await count(`select count(*) as n from ${table}`), table).toBe(0);
    }
    // The accounts stay and are reused; the catalogue is untouched.
    expect(await count("select count(*) as n from app_user")).toBe(before.users);
    expect(await count("select count(*) as n from problem")).toBe(before.problems);
    expect(await removeSeed()).toBe(0);

    await runSeed(seeded);
    expect(await count("select count(*) as n from submission")).toBe(seeded.expected.submissions);
    expect((await learnerOrNull())?.role).toBe("admin");
  }, 240_000);
});
