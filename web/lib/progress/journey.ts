/**
 * The journey: where a learner stands on the four stages, track by track.
 *
 * A read over attempts, like the rest of lib/progress. Nothing here writes a
 * grade or a state (CLAUDE.md: eval/ is the only writer); it counts which
 * problems a learner has solved and which they have opened.
 */
import type { Pool, PoolClient } from "pg";
import { db } from "../db/pool.ts";
import { DIFFICULTIES, type Difficulty } from "../policy/tiers.ts";
import { STAGES, TRACK_NAMES, type Track } from "../problems/vocabulary.ts";

export interface TierCount { difficulty: Difficulty; total: number; solved: number; attempted: number }

export interface TrackProgress {
  track: Track;
  name: string;
  total: number;
  solved: number;
  attempted: number;
  /** One entry per tier, in ladder order, including tiers with no problems. */
  tiers: TierCount[];
}

export interface StageProgress {
  id: string;
  name: string;
  blurb: string;
  tracks: TrackProgress[];
  total: number;
  solved: number;
}

export interface Journey {
  stages: StageProgress[];
  total: number;
  solved: number;
}

export async function journey(
  enrolmentId: number, client: Pool | PoolClient = db(),
): Promise<Journey> {
  const { rows } = await client.query<{
    track: string; difficulty: Difficulty; total: number; solved: number; attempted: number;
  }>(
    `select p.track, p.difficulty::text as difficulty, count(*)::int as total,
            count(a.solved_at)::int as solved,
            count(a.id) filter (where a.solved_at is null)::int as attempted
       from problem p
       left join attempt a on a.problem_id = p.id and a.enrolment_id = $1
      group by p.track, p.difficulty`, [enrolmentId]);

  const key = (track: string, difficulty: string) => `${track}:${difficulty}`;
  const counts = new Map(rows.map((r) => [key(r.track, r.difficulty), r]));

  const stages = STAGES.map((stage) => {
    const tracks = stage.tracks.map((track): TrackProgress => {
      const tiers = DIFFICULTIES.map((difficulty) => {
        const hit = counts.get(key(track, difficulty));
        return { difficulty, total: hit?.total ?? 0, solved: hit?.solved ?? 0,
                 attempted: hit?.attempted ?? 0 };
      });
      return {
        track,
        name: TRACK_NAMES[track],
        tiers,
        total: tiers.reduce((sum, t) => sum + t.total, 0),
        solved: tiers.reduce((sum, t) => sum + t.solved, 0),
        attempted: tiers.reduce((sum, t) => sum + t.attempted, 0),
      };
    });
    return {
      id: stage.id,
      name: stage.name,
      blurb: stage.blurb,
      tracks,
      total: tracks.reduce((sum, t) => sum + t.total, 0),
      solved: tracks.reduce((sum, t) => sum + t.solved, 0),
    };
  });

  return {
    stages,
    total: stages.reduce((sum, s) => sum + s.total, 0),
    solved: stages.reduce((sum, s) => sum + s.solved, 0),
  };
}

export interface ContinueItem {
  slug: string;
  title: string;
  track: string;
  difficulty: Difficulty;
  runs: number;
  lastAt: string;
}

/** The problem the learner touched most recently and has not finished. */
export async function continueItem(
  enrolmentId: number, client: Pool | PoolClient = db(),
): Promise<ContinueItem | null> {
  const { rows } = await client.query<{
    slug: string; title: string; track: string; difficulty: Difficulty; runs: number; last_at: Date;
  }>(
    `select p.slug, p.title, p.track, p.difficulty::text as difficulty,
            (select count(*) from submission s where s.attempt_id = a.id)::int as runs,
            greatest(a.first_opened_at,
                     coalesce((select max(s.queued_at) from submission s where s.attempt_id = a.id),
                              a.first_opened_at)) as last_at
       from attempt a join problem p on p.id = a.problem_id
      where a.enrolment_id = $1 and a.solved_at is null and a.gave_up_at is null
      order by last_at desc
      limit 1`, [enrolmentId]);
  const row = rows[0];
  if (!row) return null;
  return {
    slug: row.slug, title: row.title, track: row.track, difficulty: row.difficulty,
    runs: row.runs, lastAt: row.last_at.toISOString(),
  };
}
