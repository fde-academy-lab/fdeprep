/**
 * The coach, wired to the attempt.
 *
 * The browser sends what is in the editor and how long it has sat untouched.
 * Everything else the coach reads, which tests failed on the last run, how
 * many runs failed and what the tier allows, comes from the database, because
 * .claude/rules/01 says client input is never authoritative. The reply carries
 * the one nudge that fired and nothing else, so the script itself never
 * reaches the browser.
 */
import { db } from "../db/pool.ts";
import type { Coach } from "../problems/kit.ts";
import { SCREEN_CONDITIONS, tierFor, type Difficulty } from "../policy/tiers.ts";
import { nudge, type CoachState } from "./engine.ts";

export interface CoachReply {
  nudge: { id: string; say: string } | null;
  /** Said once, after a pass. */
  wrapUp: string | null;
  /** False when the coach has nothing to say on this problem at all. */
  enabled: boolean;
}

interface Row {
  difficulty: Difficulty;
  kit: { coach?: Coach } | null;
  attempt_id: string | null;
  solved: boolean;
  runs: number;
  failed_runs: number;
  in_rehearsal: boolean;
}

export async function coachReply(options: {
  enrolmentId: number;
  problemId: number;
  code: string;
  idleMinutes: number;
  dismissed: readonly string[];
}): Promise<CoachReply> {
  const { rows } = await db().query<Row>(
    `select p.difficulty::text as difficulty, v.kit, a.id as attempt_id,
            coalesce(a.solved_at is not null, false) as solved,
            coalesce((select count(*) from submission s
                       where s.attempt_id = a.id and s.verdict is not null), 0)::int as runs,
            coalesce((select count(*) from submission s
                       where s.attempt_id = a.id
                         and s.verdict is not null and s.verdict <> 'pass'), 0)::int as failed_runs,
            exists (select 1 from rehearsal r
                     where r.enrolment_id = $2 and r.finished_at is null
                       and r.ends_at > now() and p.id = any(r.problem_ids)) as in_rehearsal
       from problem p
       join problem_version v on v.problem_id = p.id and v.version = p.current_version
       left join attempt a on a.problem_id = p.id and a.enrolment_id = $2
      where p.id = $1`,
    [options.problemId, options.enrolmentId]);

  const row = rows[0];
  const coach = row?.kit?.coach;
  const rule = row?.in_rehearsal ? SCREEN_CONDITIONS.coach : row ? tierFor(row.difficulty).coach
    : SCREEN_CONDITIONS.coach;
  if (!row || !coach || !rule.enabled) return { nudge: null, wrapUp: null, enabled: false };

  const state: CoachState = {
    code: options.code,
    failedTests: row.attempt_id ? await failedTests(Number(row.attempt_id)) : [],
    runs: row.runs,
    failedRuns: row.failed_runs,
    idleMinutes: options.idleMinutes,
  };

  // After a pass the coach stops correcting and says what the problem was for.
  if (row.solved) return { nudge: null, wrapUp: coach.wrap_up ?? null, enabled: true };

  const fired = nudge(coach, state, new Set(options.dismissed), {
    codeSignals: row.failed_runs >= rule.codeSignalsAfterFailedRuns,
  });
  return {
    nudge: fired ? { id: fired.id, say: fired.say } : null,
    wrapUp: null,
    enabled: true,
  };
}

/**
 * Names of every test and probe that failed on the latest graded run.
 *
 * Read from the stored result rather than from anything the browser sends,
 * and only ever used to pick a nudge on the server. A hidden test's name does
 * not travel back: the reply carries the author's sentence, not the name.
 */
async function failedTests(attemptId: number): Promise<string[]> {
  const { rows } = await db().query<{ result: Record<string, any> | null }>(
    `select result from submission
      where attempt_id = $1 and verdict is not null and kind in ('run', 'submit', 'live')
      order by coalesce(finished_at, queued_at) desc, id desc
      limit 1`, [attemptId]);
  const gates = (rows[0]?.result?.["gates"] ?? {}) as Record<string, any>;
  const names: string[] = [];
  for (const key of ["public", "hidden", "adversarial", "probes"]) {
    for (const testCase of (gates[key]?.["cases"] ?? []) as Array<Record<string, unknown>>) {
      if (testCase["status"] !== "pass" && typeof testCase["name"] === "string") {
        names.push(testCase["name"]);
      }
    }
  }
  return names;
}
