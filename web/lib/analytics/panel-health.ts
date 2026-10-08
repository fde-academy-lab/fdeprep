/**
 * Panel health. docs/11 section 6 and acceptance 6.
 *
 * Read daily by whoever operates the platform. These numbers say whether the
 * evaluation system is working, which is a different question from whether
 * learners are: a rising partial rate is an outage the learners are absorbing
 * quietly.
 *
 * The unit is a panel run, one evaluation row the panel wrote. A re-run is a
 * run of its own, so a partial whose free re-evaluation later completes counts
 * once as partial and once as complete: the outage happened and the debt was
 * paid, and neither erases the other. A faculty correction comes from a person
 * and is left out. The re-evaluation backlog is the other view of
 * the same rows: submissions whose newest evaluation is still partial, the
 * rule reevaluationBacklog in lib/eval/record.ts drains by.
 *
 * Panelist identity appears here, which is right for an operator and why the
 * screen that shows it is admin only (docs/11 section 8).
 */
import type { Pool, PoolClient } from "pg";
import { db } from "../db/pool.ts";
import type { AutomatedPanelist } from "../eval/panel.ts";

export const PANELISTS: readonly AutomatedPanelist[] = ["static", "pretrained", "llm"];

export interface Seats { ran: number; unavailable: number; skipped: number }

export interface HourRow {
  /** The hour's start, ISO. */
  hour: string;
  runs: number;
  seats: Record<AutomatedPanelist, Seats>;
}

export interface PanelHealth {
  days: number;
  runs: number;
  complete: number;
  partial: number;
  errors: number;
  /** partial over runs, 0 to 1; 0 when nothing ran. */
  partialRate: number;
  /** Submissions whose newest evaluation is partial, owed a free re-run now. */
  backlog: number;
  oldestOwedAt: string | null;
  /** Runs where two judges both gave a band, which is when they can disagree. */
  banded: number;
  disagreements: number;
  disagreementRate: number | null;
  /** Panelist 3, the model judge: how long a run took, and how often it was not there. */
  llm: { ran: number; unavailable: number; medianMs: number | null; p95Ms: number | null };
  /** The last `hours` hours with any run in them, newest first. */
  hours: HourRow[];
}

const emptySeats = (): Record<AutomatedPanelist, Seats> => ({
  static: { ran: 0, unavailable: 0, skipped: 0 },
  pretrained: { ran: 0, unavailable: 0, skipped: 0 },
  llm: { ran: 0, unavailable: 0, skipped: 0 },
});

export async function panelHealth(options: {
  days?: number; hours?: number; client?: Pool | PoolClient;
} = {}): Promise<PanelHealth> {
  const client = options.client ?? db();
  const days = options.days ?? 7;
  const hours = options.hours ?? 24;

  const { rows: [states] } = await client.query<{
    runs: number; complete: number; partial: number; errors: number;
    banded: number; disagreements: number;
  }>(
    `select count(*)::int as runs,
            count(*) filter (where state = 'complete')::int as complete,
            count(*) filter (where state = 'partial')::int as partial,
            count(*) filter (where state = 'error')::int as errors,
            count(*) filter (where (select count(*) from jsonb_array_elements(panel) seat
                                     where seat ->> 'panelist' in ('pretrained', 'llm')
                                       and seat ? 'band') >= 2)::int as banded,
            count(*) filter (where disagreement is not null)::int as disagreements
       from evaluation
      where overridden_by is null and created_at > now() - make_interval(days => $1)`, [days]);

  const { rows: [owed] } = await client.query<{ backlog: number; oldest: Date | null }>(
    `select count(*)::int as backlog, min(created_at) as oldest from (
       select distinct on (submission_id) state, created_at
         from evaluation
        order by submission_id, created_at desc, id desc
     ) newest
      where state = 'partial'`);

  const { rows: [llm] } = await client.query<{
    ran: number; unavailable: number; median: number | null; p95: number | null;
  }>(
    `select count(*) filter (where seat ->> 'status' = 'ran')::int as ran,
            count(*) filter (where seat ->> 'status' = 'unavailable')::int as unavailable,
            percentile_cont(0.5) within group (order by (seat ->> 'ms')::numeric)
              filter (where seat ->> 'status' = 'ran') as median,
            percentile_cont(0.95) within group (order by (seat ->> 'ms')::numeric)
              filter (where seat ->> 'status' = 'ran') as p95
       from evaluation e cross join lateral jsonb_array_elements(e.panel) seat
      where e.overridden_by is null and e.created_at > now() - make_interval(days => $1)
        and seat ->> 'panelist' = 'llm'`, [days]);

  const { rows: seatRows } = await client.query<{
    hour: Date; panelist: string; status: string; n: number;
  }>(
    `select date_trunc('hour', e.created_at) as hour,
            seat ->> 'panelist' as panelist, seat ->> 'status' as status, count(*)::int as n
       from evaluation e cross join lateral jsonb_array_elements(e.panel) seat
      where e.overridden_by is null and e.created_at > now() - make_interval(hours => $1)
      group by 1, 2, 3`, [hours]);

  const { rows: runRows } = await client.query<{ hour: Date; runs: number }>(
    `select date_trunc('hour', created_at) as hour, count(*)::int as runs
       from evaluation
      where overridden_by is null and created_at > now() - make_interval(hours => $1)
      group by 1 order by 1 desc`, [hours]);

  const byHour = new Map<string, HourRow>(runRows.map((row) => {
    const hour = row.hour.toISOString();
    return [hour, { hour, runs: row.runs, seats: emptySeats() }];
  }));
  for (const row of seatRows) {
    const at = byHour.get(row.hour.toISOString());
    const panelist = row.panelist as AutomatedPanelist;
    if (!at || !PANELISTS.includes(panelist)) continue;
    const status = row.status as keyof Seats;
    if (status in at.seats[panelist]) at.seats[panelist][status] += row.n;
  }

  const runs = states!.runs;
  return {
    days,
    runs,
    complete: states!.complete,
    partial: states!.partial,
    errors: states!.errors,
    partialRate: runs === 0 ? 0 : states!.partial / runs,
    backlog: owed!.backlog,
    oldestOwedAt: owed!.oldest ? owed!.oldest.toISOString() : null,
    banded: states!.banded,
    disagreements: states!.disagreements,
    disagreementRate: states!.banded === 0 ? null : states!.disagreements / states!.banded,
    llm: {
      ran: llm!.ran,
      unavailable: llm!.unavailable,
      medianMs: llm!.median === null ? null : Math.round(Number(llm!.median)),
      p95Ms: llm!.p95 === null ? null : Math.round(Number(llm!.p95)),
    },
    hours: [...byHour.values()],
  };
}

/** Of the seats that were asked to run, the share that did; null when none was asked. */
export function availability(seats: Seats): number | null {
  const asked = seats.ran + seats.unavailable;
  return asked === 0 ? null : seats.ran / asked;
}
