/**
 * The coach, as a pure function.
 *
 * Deterministic by construction. CLAUDE.md: learner code never reaches a model
 * endpoint, in any phase, for any reason. So the coach reads the code with the
 * patterns an author wrote, reads a run by the names of the tests that failed,
 * and says what the author wrote. That also makes it instant and free, and it
 * means a nudge a learner disputes can be traced to one line of YAML.
 *
 * It runs on the server behind the coach endpoint, so the whole script never
 * reaches the browser: a learner sees the nudge that fired and nothing else.
 */
import { coachPattern, type Coach, type CoachSignal, type SignalWhen } from "../problems/kit.ts";

export interface CoachState {
  /** The editor text, or the answer text on a prompt or design problem. */
  code: string;
  /** Test and probe names that failed on the latest run or submit. */
  failedTests: readonly string[];
  runs: number;
  failedRuns: number;
  /** Minutes since the last edit. */
  idleMinutes: number;
}

export const NEUTRAL: Omit<CoachState, "code"> = {
  failedTests: [], runs: 0, failedRuns: 0, idleMinutes: 0,
};

const compiled = new Map<string, RegExp>();

function pattern(source: string): RegExp {
  let re = compiled.get(source);
  if (!re) {
    re = coachPattern(source);
    compiled.set(source, re);
  }
  return re;
}

/** Whether every condition the signal names holds. */
export function holds(when: SignalWhen, state: CoachState): boolean {
  if (when.code_matches !== undefined && !pattern(when.code_matches).test(state.code)) return false;
  if (when.code_lacks !== undefined && pattern(when.code_lacks).test(state.code)) return false;
  if (when.test_failed !== undefined && !state.failedTests.includes(when.test_failed)) return false;
  if (when.idle_minutes !== undefined && state.idleMinutes < when.idle_minutes) return false;
  if (when.runs_at_least !== undefined && state.runs < when.runs_at_least) return false;
  if (when.failed_runs_at_least !== undefined && state.failedRuns < when.failed_runs_at_least) {
    return false;
  }
  return true;
}

/**
 * Every signal that fires, in the order the author wrote them.
 *
 * Order is the author's priority: the first signal is the one the coach says,
 * so an author puts the most fundamental mistake first.
 */
export function firing(coach: Coach, state: CoachState): CoachSignal[] {
  return coach.signals.filter((signal) => holds(signal.when, state));
}

/**
 * What the coach says right now: one nudge, never a list.
 *
 * A signal the learner dismissed stays quiet until the state that fired it
 * changes, which the caller tracks by id. A coach that repeats itself after
 * being told "I know" is a coach that gets muted.
 */
export function nudge(
  coach: Coach, state: CoachState, dismissed: ReadonlySet<string> = new Set(),
): CoachSignal | null {
  return firing(coach, state).find((signal) => !dismissed.has(signal.id)) ?? null;
}
