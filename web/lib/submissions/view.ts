/**
 * What the client is allowed to see.
 *
 * docs/03 section 5: `cases` is empty for hidden and adversarial gates unless
 * the learner has already passed the problem. That trimming happens here, on
 * the server, so a hidden case name cannot reach the browser and be read out
 * of the network tab.
 */
import { db } from "../db/pool.ts";

export interface GateView {
  status: "pass" | "fail" | "skipped";
  passed: number;
  total: number;
  cases: Array<{ name: string; status: string; message: string | null }>;
}

export interface SubmissionView {
  id: number;
  status: "queued" | "running" | "evaluating" | "terminal";
  verdict: string | null;
  score: number | null;
  kind: string;
  queuedAt: string;
  finishedAt: string | null;
  gates: { static: GateView; public: GateView; hidden: GateView; adversarial: GateView };
  budget: Record<string, unknown> | null;
  message: string | null;
}

const EMPTY: GateView = { status: "skipped", passed: 0, total: 0, cases: [] };

export async function publicView(submissionId: number): Promise<SubmissionView> {
  const { rows } = await db().query<{
    id: string; status: SubmissionView["status"]; verdict: string | null;
    score: string | null; kind: string; queued_at: Date; finished_at: Date | null;
    result: Record<string, any> | null; solved_at: Date | null;
  }>(
    `select s.id, s.status, s.verdict::text, s.score, s.kind::text,
            s.queued_at, s.finished_at, s.result, a.solved_at
       from submission s join attempt a on a.id = s.attempt_id
      where s.id = $1`, [submissionId]);

  const row = rows[0];
  if (!row) throw new Error(`submission ${submissionId} not found`);

  const alreadyPassed = row.solved_at !== null;
  const gates = (row.result?.["gates"] ?? {}) as Record<string, any>;

  return {
    id: Number(row.id),
    status: row.status,
    verdict: row.verdict,
    score: row.score === null ? null : Number(row.score),
    kind: row.kind,
    queuedAt: row.queued_at.toISOString(),
    finishedAt: row.finished_at?.toISOString() ?? null,
    gates: {
      static: trim(gates["static"], true),
      public: trim(gates["public"], true),
      hidden: trim(gates["hidden"], alreadyPassed),
      adversarial: trim(gates["adversarial"], alreadyPassed),
    },
    budget: (row.result?.["budget"] ?? null) as Record<string, unknown> | null,
    message: (row.result?.["message"] ?? null) as string | null,
  };
}

function trim(gate: Record<string, any> | undefined, reveal: boolean): GateView {
  if (!gate) return { ...EMPTY, cases: [] };
  return {
    status: (gate["status"] ?? "skipped") as GateView["status"],
    passed: Number(gate["passed"] ?? 0),
    total: Number(gate["total"] ?? 0),
    cases: reveal
      ? (gate["cases"] ?? []).map((c: Record<string, unknown>) => ({
          name: String(c["name"]),
          status: String(c["status"]),
          message: c["message"] === null || c["message"] === undefined ? null : String(c["message"]),
        }))
      : [],
  };
}
