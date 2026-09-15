/**
 * Screen S7, the trace replay viewer.
 *
 * Two kinds of annotation reach a step and they are gated differently.
 *
 * The automatic ones come from the runner's post-processing in docs/03
 * section 6 and are always shown. They are the whole point of the flags: "a
 * learner who sees repeated_identical_tool_call diagnoses their own bug without
 * a hint". Hiding them would leave the learner with a red step and no reason.
 *
 * The fixture author's annotation, `annotation_md` on an adversarial test, is
 * held back until the attempt closes. docs/01 S7: "a hostile fixture can
 * explain itself after the attempt ends". Shown early it is a free hint about
 * the trap the problem exists to set.
 */
import type { Pool, PoolClient } from "pg";
import { db } from "../db/pool.ts";
import { loadTrace } from "./store.ts";

export type StepType = "llm_call" | "tool_call" | "observation" | "final" | "marker";

export interface ReplayStep {
  index: number;
  seq: number;
  caseName: string;
  type: StepType;
  summary: string;
  /** The long fields S7 puts behind an expander. */
  detail: Record<string, unknown>;
  flags: string[];
  /** From the runner's post-processing. Always shown. */
  annotation: string | null;
  /** From the fixture author. Null until the attempt closes. */
  fixtureAnnotation: string | null;
}

export interface Replay {
  submissionId: number;
  steps: ReplayStep[];
  flags: string[];
  llmCalls: number;
  toolCalls: number;
  truncated: boolean;
  /** True once the learner has passed or given up, which opens the annotations. */
  attemptClosed: boolean;
  available: boolean;
}

const EMPTY: Omit<Replay, "submissionId"> = {
  steps: [], flags: [], llmCalls: 0, toolCalls: 0,
  truncated: false, attemptClosed: false, available: false,
};

export async function replayFor(
  submissionId: number, client: Pool | PoolClient = db(),
): Promise<Replay> {
  const { rows } = await client.query<{
    solved_at: Date | null; gave_up_at: Date | null; problem_version_id: string;
  }>(
    `select a.solved_at, a.gave_up_at, s.problem_version_id
       from submission s join attempt a on a.id = s.attempt_id
      where s.id = $1`, [submissionId]);
  const row = rows[0];
  if (!row) return { submissionId, ...EMPTY };

  // docs/01 S7: on a failed Extreme submission the trace is available, because
  // the learning happens there even though the attempt is spent. The trace is
  // never withheld; only the fixture author's note waits.
  const attemptClosed = row.solved_at !== null || row.gave_up_at !== null;

  const stored = await loadTrace(submissionId, client);
  if (!stored) return { submissionId, ...EMPTY, attemptClosed };

  const annotations = attemptClosed
    ? await fixtureAnnotations(client, Number(row.problem_version_id))
    : new Map<string, string>();

  const cases = Array.isArray(stored.body["cases"])
    ? (stored.body["cases"] as Array<Record<string, unknown>>) : [];

  const steps: ReplayStep[] = [];
  for (const entry of cases) {
    const caseName = String(entry["name"] ?? "case");
    const trace = (entry["trace"] ?? {}) as Record<string, unknown>;
    const raw = Array.isArray(trace["steps"]) ? (trace["steps"] as Array<Record<string, unknown>>) : [];
    for (const step of raw) {
      steps.push({
        index: steps.length,
        seq: Number(step["seq"] ?? steps.length + 1),
        caseName,
        type: (step["type"] ?? "marker") as StepType,
        summary: summarise(step),
        detail: detailOf(step),
        flags: Array.isArray(step["flags"]) ? (step["flags"] as string[]) : [],
        annotation: step["annotation"] === undefined ? null : String(step["annotation"]),
        fixtureAnnotation: annotations.get(caseName) ?? null,
      });
    }
  }

  return {
    submissionId,
    steps,
    flags: stored.flags,
    llmCalls: steps.filter((s) => s.type === "llm_call").length,
    toolCalls: steps.filter((s) => s.type === "tool_call").length,
    truncated: stored.truncated,
    attemptClosed,
    available: steps.length > 0,
  };
}

async function fixtureAnnotations(
  client: Pool | PoolClient, problemVersionId: number,
): Promise<Map<string, string>> {
  const { rows } = await client.query<{ name: string; annotation_md: string | null }>(
    `select name, annotation_md from problem_test
      where problem_version_id = $1 and annotation_md is not null`, [problemVersionId]);
  return new Map(rows.filter((r) => r.annotation_md).map((r) => [r.name, r.annotation_md!]));
}

/**
 * The one-line form S7 lists in the step column. Never empty: a loop that
 * returned an empty string still has to occupy a row the learner can select,
 * and a blank line reads as a rendering bug rather than as the answer.
 */
function summarise(step: Record<string, unknown>): string {
  return summaryText(step) || `${step["type"] ?? "step"} with no content`;
}

function summaryText(step: Record<string, unknown>): string {
  switch (step["type"]) {
    case "llm_call":
      return `prompt ${step["prompt_chars"] ?? String(step["prompt"] ?? "").length} chars ` +
             `-> ${truncateText(String(step["response"] ?? ""), 60)}`;
    case "tool_call":
      return `${step["tool"]}(${renderArgs(step["args"])})`;
    case "observation":
      return truncateText(JSON.stringify(step["value"] ?? null), 80);
    case "final":
      return truncateText(String(step["value"] ?? ""), 80);
    default:
      return String(step["note"] ?? step["type"] ?? "");
  }
}

function detailOf(step: Record<string, unknown>): Record<string, unknown> {
  const detail: Record<string, unknown> = {};
  for (const key of ["prompt", "response", "args", "value", "tool", "ms"]) {
    if (step[key] !== undefined) detail[key] = step[key];
  }
  return detail;
}

function renderArgs(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  return Object.entries(args as Record<string, unknown>)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(", ");
}

function truncateText(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}
