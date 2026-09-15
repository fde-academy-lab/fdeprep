/**
 * The two summaries S2 shows below Next Up.
 *
 * Both are derived views over what the heatmap and the attempt history already
 * hold, so the roadmap screen and the progress screen cannot disagree about a
 * learner's standing.
 */
import type { Pool, PoolClient } from "pg";
import { db } from "../db/pool.ts";
import { attemptHistory, type Heatmap } from "./index.ts";
import type { State } from "../competency/score.ts";

export interface CompetencyBar {
  slug: string;
  name: string;
  /** Out of ten, which is the width S2 draws. */
  filled: number;
  label: string;
}

/** How much of a bar each state earns. */
const WEIGHT: Record<State, number> = { untouched: 0, attempted: 1, passed: 2, clean: 3 };

/**
 * The label names the best state reached; the bar length shows how far across
 * the ladder that goes.
 *
 * An adjective scale over the fraction was the first attempt and it lied. One
 * clean cell out of four tiers is a quarter of the bar, so a learner who
 * cleanly passed the only problem they had tried read as "needs work". The
 * product already has four words for how well someone did something, and
 * CLAUDE.md says to repeat a noun rather than rename it, so these are those
 * four words.
 */
const LABELS: Record<State, string> = {
  clean: "passed clean",
  passed: "passed",
  attempted: "attempted",
  untouched: "not attempted",
};

/**
 * docs/01 S2: at most four rows, the two strongest and the two weakest with at
 * least one attempt. A competency nobody has touched is not weak, it is
 * unstarted, and putting it in the weak slots buries the ones that need work.
 */
export function topAndBottom(grid: Heatmap, limit = 4): CompetencyBar[] {
  const scored = grid.rows.map((row) => {
    const earned = row.cells.reduce((sum, cell) => sum + WEIGHT[cell.state], 0);
    const possible = row.cells.length * WEIGHT.clean;
    const best = row.cells.reduce<State>(
      (top, cell) => (WEIGHT[cell.state] > WEIGHT[top] ? cell.state : top), "untouched");
    return {
      slug: row.slug,
      name: row.name,
      fraction: possible === 0 ? 0 : earned / possible,
      best,
      touched: best !== "untouched",
    };
  }).filter((row) => row.touched);

  scored.sort((a, b) => b.fraction - a.fraction || a.slug.localeCompare(b.slug));

  const half = Math.floor(limit / 2);
  const chosen = scored.length <= limit
    ? scored
    : [...scored.slice(0, half), ...scored.slice(-(limit - half))];

  return chosen.map((row) => ({
    slug: row.slug,
    name: row.name,
    filled: Math.max(1, Math.round(row.fraction * 10)),
    label: LABELS[row.best],
  }));
}

export interface ActivityRow {
  slug: string;
  title: string;
  verdict: string | null;
  whenLabel: string;
  submits: number;
}

/** The last few finished attempts, newest first. */
export async function recentActivity(
  enrolmentId: number, limit = 5, client: Pool | PoolClient = db(),
): Promise<ActivityRow[]> {
  const rows = await attemptHistory(enrolmentId, client);
  return rows
    .filter((row) => row.verdict !== null)
    .slice(0, limit)
    .map((row) => ({
      slug: row.slug,
      title: row.title,
      verdict: row.verdict,
      whenLabel: row.lastAt ? relativeDay(row.lastAt) : "",
      submits: row.submits,
    }));
}

export function relativeDay(iso: string, now: Date = new Date()): string {
  const days = Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  return months === 1 ? "a month ago" : `${months} months ago`;
}
