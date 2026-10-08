/**
 * S14.5's measurement: the cost and the gap of interview sessions, priced at
 * rates given on the command line. Written before the script.
 */
import { describe, expect, test } from "vitest";
import {
  costRows, parseArgs, percentile, SCORER_CALLS, summarise, toCsv, UsageError, type SessionFact,
  type TurnFact,
} from "../scripts/voice-interview-cost.ts";

const turn = (over: Partial<TurnFact>): TurnFact => ({
  source: "generated", fallbackReason: null, gapMs: 3_000, generationMs: 1_800, lateGenerationMs: null,
  modelCalls: 1, inputTokens: 1_000, outputTokens: 50, ...over,
});

/** Three sessions: one all generated, one with a timeout and a late reply,
 *  one panel whose judge failed every round. */
const SESSIONS: SessionFact[] = [
  { sessionId: 11, startedAt: "2026-10-12T09:00:00Z", interviewer: "cto", scorerCalls: 2,
    turns: [turn({ gapMs: 2_000 }), turn({ gapMs: 3_000 }), turn({ gapMs: 4_000 })] },
  { sessionId: 12, startedAt: "2026-10-12T10:00:00Z", interviewer: "client", scorerCalls: 2,
    turns: [turn({ gapMs: 5_000 }),
            turn({ source: "authored", fallbackReason: "timeout", gapMs: 6_500, generationMs: null,
                   lateGenerationMs: 5_200, inputTokens: 900, outputTokens: 40 })] },
  { sessionId: 13, startedAt: "2026-10-12T11:00:00Z", interviewer: "panel", scorerCalls: 2,
    turns: [turn({ source: "authored", fallbackReason: "error", modelCalls: 0, inputTokens: null,
                   outputTokens: null, generationMs: 40, gapMs: 1_000 }),
            turn({ source: "probe", fallbackReason: "error", modelCalls: 0, inputTokens: null,
                   outputTokens: null, generationMs: 40, gapMs: 1_200 })] },
];
const RATES = { inPerMTok: 3, outPerMTok: 15 };

describe("pricing interview sessions", () => {
  test("one row per session, priced at the rates given, with the scorer's calls in the count", () => {
    const rows = costRows(SESSIONS, RATES);
    expect(rows.map((row) => row.session)).toEqual([11, 12, 13]);
    expect(rows[0]).toMatchObject({ rounds: 3, generated: 3, fallbacks: 0, tokensIn: 3_000, tokensOut: 150,
                                    calls: 3 + SCORER_CALLS });
    expect(rows[0]!.cost).toBeCloseTo(3_000 / 1e6 * 3 + 150 / 1e6 * 15, 10);
    expect(rows[1]).toMatchObject({ generated: 1, fallbacks: 1, tokensIn: 1_900, tokensOut: 90 });
    expect(rows[2]).toMatchObject({ fallbacks: 2, calls: SCORER_CALLS, cost: 0 });
  });

  test("the gap's p50 and p95 are nearest-rank, per session and over every round", () => {
    const rows = costRows(SESSIONS, RATES);
    expect([rows[0]!.gapP50, rows[0]!.gapP95]).toEqual([3_000, 4_000]);
    // A late reply still tells how long the model took, so it counts there.
    expect(rows[1]!.generationP95).toBe(5_200);
    const summary = summarise(SESSIONS, rows);
    // Seven gaps: 1000 1200 2000 3000 4000 5000 6500.
    expect(summary.gapP50).toBe(3_000);
    expect(summary.gapP95).toBe(6_500);
    expect(summary.rounds).toBe(7);
    expect(summary.fallbackShare).toBeCloseTo(3 / 7, 10);
    expect(percentile([], 95)).toBeNull();
  });

  test("the CSV has one header and one row per session", () => {
    const lines = toCsv(costRows(SESSIONS, RATES)).trimEnd().split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe("session,interviewer,rounds,generated,fallbacks,calls,tokens_in,tokens_out,cost," +
                          "gap_p50_ms,gap_p95_ms,generation_p50_ms,generation_p95_ms");
    expect(lines[1]!.startsWith("11,cto,3,3,0,5,3000,150,")).toBe(true);
  });

  test("the rates are arguments, and a run without them says what to type", () => {
    expect(parseArgs(["--since", "2026-10-12", "--in-per-mtok", "3", "--out-per-mtok", "15", "--csv"]))
      .toEqual({ since: new Date("2026-10-12"), rates: RATES, csv: true });
    expect(() => parseArgs(["--since", "2026-10-12"])).toThrow(UsageError);
  });
});
