/**
 * What interview mode cost, and how long learners waited between turns.
 * S14.5, docs/07 section 5a.
 *
 *   npm run voice:cost -- --since 2026-10-12 --in-per-mtok 3 --out-per-mtok 15
 *   npm run voice:cost -- --since 2026-10-12 --in-per-mtok 3 --out-per-mtok 15 --csv
 *
 * One row per interview session since the date: its rounds, how many the
 * model asked and how many fell back, the model calls and tokens, the cost at
 * the rates given, and the median and 95th percentile of the gap between
 * turns and of the model's generation time. A summary line follows. The rates
 * are arguments and never constants, because S14.5 prices the sessions at
 * Bedrock's published rates on the day the numbers are read.
 *
 * The calls column adds the scorer's own calls for the session, two unless
 * the judge recorded another number, so the count is the whole session. The
 * scorer's tokens are not recorded per session, so the cost is the rounds'.
 * Needs DATABASE_URL and nothing else.
 */
import { closeDb, db } from "../lib/db/pool.ts";

export type TurnFact = {
  source: string;
  fallbackReason: string | null;
  gapMs: number | null;
  generationMs: number | null;
  lateGenerationMs: number | null;
  modelCalls: number;
  inputTokens: number | null;
  outputTokens: number | null;
};

export type SessionFact = {
  sessionId: number;
  startedAt: string;
  interviewer: string | null;
  /** The scorer's model calls for this session, from its result. */
  scorerCalls: number;
  turns: TurnFact[];
};

export type Rates = { inPerMTok: number; outPerMTok: number };

export type CostRow = {
  session: number;
  interviewer: string;
  rounds: number;
  generated: number;
  fallbacks: number;
  calls: number;
  tokensIn: number;
  tokensOut: number;
  /** In the currency of the rates, usually US dollars. */
  cost: number;
  gapP50: number | null;
  gapP95: number | null;
  generationP50: number | null;
  generationP95: number | null;
};

/** The scorer makes two calls per session, docs/07 section 6. */
export const SCORER_CALLS = 2;

/** Nearest-rank percentile: the smallest value with at least p percent of
 *  the values at or below it. Null for no values. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1]!;
}

function priced(tokensIn: number, tokensOut: number, rates: Rates): number {
  return (tokensIn / 1_000_000) * rates.inPerMTok + (tokensOut / 1_000_000) * rates.outPerMTok;
}

export function costRows(sessions: readonly SessionFact[], rates: Rates): CostRow[] {
  return sessions.map((session) => {
    const turns = session.turns;
    const tokensIn = turns.reduce((sum, turn) => sum + (turn.inputTokens ?? 0), 0);
    const tokensOut = turns.reduce((sum, turn) => sum + (turn.outputTokens ?? 0), 0);
    const gaps = turns.flatMap((turn) => (turn.gapMs === null ? [] : [turn.gapMs]));
    const generations = turns.flatMap((turn) => {
      const ms = turn.generationMs ?? turn.lateGenerationMs;
      return ms === null ? [] : [ms];
    });
    return {
      session: session.sessionId,
      interviewer: session.interviewer ?? "none",
      rounds: turns.length,
      generated: turns.filter((turn) => turn.source === "generated").length,
      fallbacks: turns.filter((turn) => turn.source !== "generated").length,
      calls: turns.reduce((sum, turn) => sum + turn.modelCalls, 0) + session.scorerCalls,
      tokensIn,
      tokensOut,
      cost: priced(tokensIn, tokensOut, rates),
      gapP50: percentile(gaps, 50),
      gapP95: percentile(gaps, 95),
      generationP50: percentile(generations, 50),
      generationP95: percentile(generations, 95),
    };
  });
}

export type Summary = {
  sessions: number;
  rounds: number;
  fallbackShare: number;
  calls: number;
  cost: number;
  gapP50: number | null;
  gapP95: number | null;
  generationP95: number | null;
};

/** Every session together: the percentiles are over every round, not an
 *  average of the sessions'. */
export function summarise(sessions: readonly SessionFact[], rows: readonly CostRow[]): Summary {
  const turns = sessions.flatMap((session) => session.turns);
  const gaps = turns.flatMap((turn) => (turn.gapMs === null ? [] : [turn.gapMs]));
  const generations = turns.flatMap((turn) => {
    const ms = turn.generationMs ?? turn.lateGenerationMs;
    return ms === null ? [] : [ms];
  });
  const rounds = turns.length;
  return {
    sessions: rows.length,
    rounds,
    fallbackShare: rounds === 0 ? 0 : turns.filter((turn) => turn.source !== "generated").length / rounds,
    calls: rows.reduce((sum, row) => sum + row.calls, 0),
    cost: rows.reduce((sum, row) => sum + row.cost, 0),
    gapP50: percentile(gaps, 50),
    gapP95: percentile(gaps, 95),
    generationP95: percentile(generations, 95),
  };
}

const COLUMNS: Array<[keyof CostRow, string]> = [
  ["session", "session"], ["interviewer", "interviewer"], ["rounds", "rounds"],
  ["generated", "generated"], ["fallbacks", "fallbacks"], ["calls", "calls"],
  ["tokensIn", "tokens_in"], ["tokensOut", "tokens_out"], ["cost", "cost"],
  ["gapP50", "gap_p50_ms"], ["gapP95", "gap_p95_ms"],
  ["generationP50", "generation_p50_ms"], ["generationP95", "generation_p95_ms"],
];

function cell(row: CostRow, key: keyof CostRow): string {
  const value = row[key];
  if (value === null) return "";
  if (key === "cost") return (value as number).toFixed(6);
  return String(value);
}

/** One header line and one line per session. */
export function toCsv(rows: readonly CostRow[]): string {
  const quote = (text: string) => (/[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text);
  return [COLUMNS.map(([, name]) => name).join(","),
          ...rows.map((row) => COLUMNS.map(([key]) => quote(cell(row, key))).join(","))].join("\n") + "\n";
}

export function toTable(rows: readonly CostRow[]): string {
  const lines = [COLUMNS.map(([, name]) => name), ...rows.map((row) => COLUMNS.map(([key]) => cell(row, key)))];
  const widths = COLUMNS.map((_, index) => Math.max(...lines.map((line) => line[index]!.length)));
  return lines.map((line) => line.map((text, index) => text.padEnd(widths[index]!)).join("  ").trimEnd())
    .join("\n") + "\n";
}

export function summaryLine(summary: Summary, rates: Rates): string {
  const seconds = (ms: number | null) => (ms === null ? "none" : `${(ms / 1000).toFixed(1)}s`);
  return `${summary.sessions} sessions, ${summary.rounds} rounds, ` +
    `${Math.round(summary.fallbackShare * 100)}% fell back, ${summary.calls} model calls, ` +
    `cost ${summary.cost.toFixed(4)} at ${rates.inPerMTok} in and ${rates.outPerMTok} out per million ` +
    `tokens, gap p50 ${seconds(summary.gapP50)} and p95 ${seconds(summary.gapP95)}, ` +
    `generation p95 ${seconds(summary.generationP95)}.`;
}

/** Every interview session that started on or after `since`, with its rounds. */
export async function loadSessions(since: Date): Promise<SessionFact[]> {
  const { rows: sessions } = await db().query<{
    id: string; started_at: Date; interviewer_slug: string | null; calls: string | null;
  }>(
    `select id, started_at, interviewer_slug, judge_result ->> 'modelCalls' as calls
       from voice_session
      where mode = 'interview' and started_at >= $1
      order by started_at`, [since]);
  const { rows: turns } = await db().query<{
    voice_session_id: string; source: string; fallback_reason: string | null; gap_ms: number | null;
    generation_ms: number | null; late_generation_ms: number | null; model_calls: number;
    input_tokens: number | null; output_tokens: number | null;
  }>(
    `select t.voice_session_id, t.source, t.fallback_reason, t.gap_ms, t.generation_ms,
            t.late_generation_ms, t.model_calls, t.input_tokens, t.output_tokens
       from voice_turn t join voice_session s on s.id = t.voice_session_id
      where s.mode = 'interview' and s.started_at >= $1
      order by t.voice_session_id, t.ordinal`, [since]);
  return sessions.map((session) => ({
    sessionId: Number(session.id),
    startedAt: session.started_at.toISOString(),
    interviewer: session.interviewer_slug,
    scorerCalls: session.calls === null ? SCORER_CALLS : Number(session.calls),
    turns: turns.filter((turn) => turn.voice_session_id === session.id).map((turn) => ({
      source: turn.source,
      fallbackReason: turn.fallback_reason,
      gapMs: turn.gap_ms,
      generationMs: turn.generation_ms,
      lateGenerationMs: turn.late_generation_ms,
      modelCalls: turn.model_calls,
      inputTokens: turn.input_tokens,
      outputTokens: turn.output_tokens,
    })),
  }));
}

export class UsageError extends Error {}

export function parseArgs(argv: readonly string[]): { since: Date; rates: Rates; csv: boolean } {
  const value = (flag: string) => {
    const at = argv.indexOf(flag);
    return at === -1 ? undefined : argv[at + 1];
  };
  const since = new Date(value("--since") ?? "");
  const inPerMTok = Number(value("--in-per-mtok"));
  const outPerMTok = Number(value("--out-per-mtok"));
  if (Number.isNaN(since.getTime()) || !Number.isFinite(inPerMTok) || !Number.isFinite(outPerMTok) ||
      value("--in-per-mtok") === undefined || value("--out-per-mtok") === undefined) {
    throw new UsageError(
      "Give a start date and the rates per million tokens, for example: npm run voice:cost -- " +
      "--since 2026-10-12 --in-per-mtok 3 --out-per-mtok 15, and add --csv for a spreadsheet.");
  }
  return { since, rates: { inPerMTok, outPerMTok }, csv: argv.includes("--csv") };
}

if (import.meta.filename === process.argv[1]) {
  try {
    const { since, rates, csv } = parseArgs(process.argv.slice(2));
    const sessions = await loadSessions(since);
    const rows = costRows(sessions, rates);
    process.stdout.write(csv ? toCsv(rows) : toTable(rows));
    console.log(summaryLine(summarise(sessions, rows), rates));
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}
