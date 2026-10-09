/**
 * Screen S7, the trace replay viewer.
 *
 * Who reads a case decides how much of it they read. Decided on 8 October 2026
 * and written into docs/01 S7 and docs/03 section 5: a learner reads each
 * public case in full, and each hidden or adversarial case as one anonymous
 * row in the place it ran, which says how the case ended and nothing it held.
 * No name, input, prompt, model reply, tool argument, output or message of an
 * unpublished case reaches a learner's browser, because the filtering happens
 * here, on the server. Where the tier shows the hidden count each case has its
 * own row, "Hidden case 2 of 4: failed". Where it shows nothing about the
 * tests, Extreme and screen conditions, a battery's cases share one row, since
 * a row per case would count them. Faculty and admins read every case in full,
 * and the stored trace stays whole for them and for an appeal.
 *
 * A case is public to a learner only when the problem version lists it as
 * public and the runner, where it says, ran it in the public battery. A case
 * the problem does not list is read as unpublished.
 *
 * Two kinds of annotation reach a step and they are gated differently.
 *
 * The automatic ones come from the runner's post-processing in docs/03
 * section 6 and are always shown on a case the reader can read. They are the
 * whole point of the flags: "a learner who sees repeated_identical_tool_call
 * diagnoses their own bug without a hint". Hiding them would leave the learner
 * with a red step and no reason.
 *
 * The fixture author's annotation, `annotation_md` on an adversarial test, is
 * held back from a learner until the attempt closes. docs/01 S7: "a hostile
 * fixture can explain itself after the attempt ends". Shown early it is a free
 * hint about the trap the problem exists to set. Once the attempt closes it
 * goes on the case's anonymous row, because docs/03 section 3 promises it to
 * the learner then. Faculty read it at any time.
 */
import type { Pool, PoolClient } from "pg";
import { db } from "../db/pool.ts";
import { SITTING_SQL, type Difficulty } from "../policy/index.ts";
import { countsUnpublished } from "../submissions/view.ts";
import { loadTrace } from "./store.ts";

/**
 * The runner's step types from docs/03 section 6, and `withheld`, the row that
 * stands in for a case the reader may not read. A type this list lacks renders
 * as a marker.
 */
export type StepType =
  | "llm_call" | "tool_call" | "observation" | "final" | "refused" | "error" | "marker"
  | "withheld";

export type Battery = "public" | "hidden" | "adversarial";

/** Who is reading. Faculty and admins read every case; a learner reads the public ones. */
export type Audience = "learner" | "faculty";

export interface ReplayStep {
  index: number;
  seq: number;
  /** The case's name. Null on a row that stands in for a case the reader may not read. */
  caseName: string | null;
  /** The battery the case ran in, where the runner or the problem says. */
  battery: Battery | null;
  /** How the case ended, where the runner or the result says. */
  caseStatus: "pass" | "fail" | null;
  type: StepType;
  summary: string;
  /** The long fields S7 puts behind an expander. Empty on a withheld row. */
  detail: Record<string, unknown>;
  flags: string[];
  /** From the runner's post-processing. Always shown. */
  annotation: string | null;
  /** From the fixture author. Null to a learner until the attempt closes. */
  fixtureAnnotation: string | null;
}

export interface Replay {
  submissionId: number;
  audience: Audience;
  steps: ReplayStep[];
  /** The flags of the cases this reader reads in full. */
  flags: string[];
  llmCalls: number;
  toolCalls: number;
  /** Calls the budget refused, which never ran and are not in the two counts above. */
  refusedCalls: number;
  truncated: boolean;
  /** True once the learner has passed or given up, which opens the annotations. */
  attemptClosed: boolean;
  available: boolean;
}

export interface ReplayOptions {
  /**
   * The learner unless the caller says otherwise, so a caller that forgets to
   * say gets the narrower replay.
   */
  audience?: Audience;
  client?: Pool | PoolClient;
}

const EMPTY = {
  steps: [], flags: [], llmCalls: 0, toolCalls: 0, refusedCalls: 0,
  truncated: false, attemptClosed: false, available: false,
};

const BATTERIES: readonly Battery[] = ["public", "hidden", "adversarial"];

/** A case as the stored trace holds it, with what the problem version says about it. */
interface Entry {
  name: string;
  battery: Battery | null;
  status: "pass" | "fail" | null;
  trace: Record<string, unknown>;
  readable: boolean;
  annotation: string | null;
}

export async function replayFor(
  submissionId: number, options: ReplayOptions = {},
): Promise<Replay> {
  const client = options.client ?? db();
  const audience = options.audience ?? "learner";
  const faculty = audience === "faculty";

  const { rows } = await client.query<{
    solved_at: Date | null; gave_up_at: Date | null; problem_version_id: string; kind: string;
    difficulty: Difficulty; sitting: boolean; result: Record<string, any> | null;
  }>(
    `select a.solved_at, a.gave_up_at, s.problem_version_id, s.kind::text as kind,
            p.difficulty::text as difficulty, ${SITTING_SQL} as sitting, s.result
       from submission s join attempt a on a.id = s.attempt_id
       join problem p on p.id = a.problem_id
      where s.id = $1`, [submissionId]);
  const row = rows[0];
  if (!row) return { submissionId, audience, ...EMPTY };

  // docs/01 S7: on a failed Extreme submission the trace is available, because
  // the learning happens there even though the attempt is spent. What a
  // learner reads of it is the public cases and how the others ended.
  const attemptClosed = row.solved_at !== null || row.gave_up_at !== null;
  const notesOpen = faculty || attemptClosed;

  const stored = await loadTrace(submissionId, client);
  if (!stored) return { submissionId, audience, ...EMPTY, attemptClosed };

  const listed = await caseList(client, Number(row.problem_version_id));
  const gates = (row.result?.["gates"] ?? {}) as Record<string, any>;
  const entries = (Array.isArray(stored.body["cases"])
    ? (stored.body["cases"] as Array<Record<string, unknown>>) : [])
    .map((raw): Entry => {
      const name = String(raw["name"] ?? "case");
      const known = listed.get(name);
      const ran = batteryOf(raw["battery"]);
      const readable = faculty || (known?.visibility === "public" && (ran === null || ran === "public"));
      const battery = readable ? known?.visibility ?? ran
        // An unpublished case's row never says public, whichever source did.
        : [known?.visibility ?? null, ran].find((b) => b !== null && b !== "public") ?? null;
      return {
        name, battery,
        status: statusOf(raw["status"]) ?? settled(battery ? gates[battery] : undefined),
        trace: (raw["trace"] ?? {}) as Record<string, unknown>,
        readable,
        annotation: known?.annotation ?? null,
      };
    });

  // A Run executes the public cases only (docs/00 section 4). A Run written
  // before 8 October 2026 ran the whole battery and stored every case, and a
  // learner reads no row for a case a Run should never have run.
  const visible = row.kind === "run" && !faculty ? entries.filter((e) => e.readable) : entries;
  const counted = countsUnpublished(row.difficulty, row.kind, row.sitting);

  const steps: ReplayStep[] = [];
  const shown: Array<Record<string, unknown>> = [];
  const groups = new Map<string, Entry[]>();
  for (const entry of visible) {
    if (entry.readable) continue;
    const key = entry.battery ?? "unpublished";
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }

  for (const entry of visible) {
    if (entry.readable) {
      shown.push(entry.trace);
      const raw = Array.isArray(entry.trace["steps"])
        ? (entry.trace["steps"] as Array<Record<string, unknown>>) : [];
      for (const step of raw) {
        steps.push({
          index: steps.length,
          seq: Number(step["seq"] ?? steps.length + 1),
          caseName: entry.name,
          battery: entry.battery,
          caseStatus: entry.status,
          type: (step["type"] ?? "marker") as StepType,
          summary: summarise(step),
          detail: detailOf(step),
          flags: Array.isArray(step["flags"]) ? (step["flags"] as string[]) : [],
          annotation: step["annotation"] === undefined ? null : String(step["annotation"]),
          fixtureAnnotation: notesOpen ? entry.annotation : null,
        });
      }
      continue;
    }

    const group = groups.get(entry.battery ?? "unpublished")!;
    if (counted) {
      steps.push(withheldRow(steps.length, entry, {
        summary: `${label(entry.battery)} case ${group.indexOf(entry) + 1} of ${group.length}: ` +
                 outcome(entry.status),
        notes: notesOpen && entry.annotation ? [entry.annotation] : [],
      }));
    } else if (group[0] === entry) {
      // One row for the battery, where its first case ran.
      const status = group.some((e) => e.status === "fail") ? "fail"
        : group.every((e) => e.status === "pass") ? "pass" : null;
      steps.push(withheldRow(steps.length, { ...entry, status }, {
        summary: `${label(entry.battery)} cases: ` +
                 (status === "pass" ? "every one passed"
                   : status === "fail" ? "at least one failed" : "outcome not recorded"),
        notes: notesOpen ? [...new Set(group.flatMap((e) => (e.annotation ? [e.annotation] : [])))] : [],
      }));
    }
  }

  return {
    submissionId,
    audience,
    steps,
    // The stored flags and truncation cover every case in the trace, so they
    // are read back from the cases this reader reads in full.
    flags: [...new Set(shown.flatMap((t) => (Array.isArray(t["flags"]) ? t["flags"] as string[] : [])))]
      .sort(),
    llmCalls: steps.filter((s) => s.type === "llm_call").length,
    toolCalls: steps.filter((s) => s.type === "tool_call").length,
    refusedCalls: steps.filter((s) => s.type === "refused")
      .reduce((total, s) => total + 1 + Number(s.detail["repeats"] ?? 0), 0),
    truncated: shown.some((t) => t["truncated"] === true),
    attemptClosed,
    available: steps.length > 0,
  };
}

/** The row that stands in for an unpublished case, holding how it ended and nothing else. */
function withheldRow(
  index: number, entry: Pick<Entry, "battery" | "status">,
  content: { summary: string; notes: string[] },
): ReplayStep {
  return {
    index, seq: 0, caseName: null, battery: entry.battery, caseStatus: entry.status,
    type: "withheld", summary: content.summary, detail: {}, flags: [], annotation: null,
    fixtureAnnotation: content.notes.length ? content.notes.join("\n\n") : null,
  };
}

function label(battery: Battery | null): string {
  return battery === "adversarial" ? "Adversarial" : battery === "hidden" ? "Hidden" : "Unpublished";
}

function outcome(status: "pass" | "fail" | null): string {
  return status === "pass" ? "passed" : status === "fail" ? "failed" : "outcome not recorded";
}

function batteryOf(value: unknown): Battery | null {
  return BATTERIES.find((battery) => battery === value) ?? null;
}

function statusOf(value: unknown): "pass" | "fail" | null {
  return value === "pass" || value === "fail" ? value : null;
}

/**
 * Every case of a battery ended the same way when the gate says so: it passed,
 * or none of its cases did. Otherwise the gate cannot say which case failed.
 * This is how a trace stored before the runner wrote each case's outcome gets
 * one where it can.
 */
function settled(gate: Record<string, unknown> | undefined): "pass" | "fail" | null {
  if (gate?.["status"] === "pass") return "pass";
  if (gate?.["status"] === "fail" && Number(gate["passed"] ?? -1) === 0) return "fail";
  return null;
}

/**
 * Every case the problem version lists, with its battery and the fixture
 * author's note. A name listed twice under two batteries reads as hidden, so
 * a slip in the content can only narrow what a learner reads.
 */
async function caseList(
  client: Pool | PoolClient, problemVersionId: number,
): Promise<Map<string, { visibility: Battery; annotation: string | null }>> {
  const { rows } = await client.query<{
    name: string; visibility: Battery; annotation_md: string | null;
  }>(
    `select name, visibility::text as visibility, annotation_md from problem_test
      where problem_version_id = $1 order by ordinal`, [problemVersionId]);
  const out = new Map<string, { visibility: Battery; annotation: string | null }>();
  for (const test of rows) {
    const earlier = out.get(test.name);
    out.set(test.name, {
      visibility: earlier && earlier.visibility !== test.visibility ? "hidden" : test.visibility,
      annotation: test.annotation_md || earlier?.annotation || null,
    });
  }
  return out;
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
    case "refused": {
      // A call past the case's budget. Every later call of the same kind was
      // refused too, and the runner counts those rather than listing them.
      const call = step["op"] === "tool"
        ? `${step["tool"]}(${renderArgs(step["args"])})`
        : `model call, prompt ${step["prompt_chars"] ?? String(step["prompt"] ?? "").length} chars`;
      const repeats = Number(step["repeats"] ?? 0);
      return `refused ${call}${repeats ? `, and ${repeats} more after it` : ""}`;
    }
    case "error":
      return `${step["error_type"] ?? "Error"}: ${truncateText(String(step["message"] ?? ""), 80)}`;
    default:
      return String(step["note"] ?? step["message"] ?? step["type"] ?? "");
  }
}

function detailOf(step: Record<string, unknown>): Record<string, unknown> {
  const detail: Record<string, unknown> = {};
  for (const key of ["prompt", "response", "args", "value", "tool", "error_type", "message", "repeats", "ms"]) {
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
