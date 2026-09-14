/**
 * The trusted half of the step protocol (docs/03 section 9.4).
 *
 * The sandbox returns a typed action and its next serialisable state. This
 * worker validates the action, applies policy, calls the model on the
 * learner's behalf, and records the authoritative event. The trace is
 * trustworthy because this side wrote it, not the learner.
 *
 * The credential lives here and never moves. Learner code receives a callable
 * that marshals through this, which is why the same run_agent works in both
 * modes without holding anything.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { db, inTransaction } from "../db/pool.ts";

const REPO_ROOT = path.join(import.meta.dirname, "..", "..", "..");

export type Action =
  | { kind: "llm_call"; prompt: string; call_index: number }
  | { kind: "tool_call"; tool: string; args: Record<string, unknown>; call_index: number };

export interface StepResult {
  schema: "fdeprep.step.v1";
  status: "suspended" | "finished" | "error";
  action?: Action;
  state?: unknown[];
  value?: unknown;
  message?: string;
  steps_used: number;
}

/** What the worker is allowed to do on the learner's behalf. */
export interface ModelClient {
  complete(input: { modelId: string; prompt: string }): Promise<string>;
}

export interface ToolClient {
  call(input: { tool: string; args: Record<string, unknown> }): Promise<unknown>;
}

/** Caps the number of protocol round trips, so a loop cannot spend forever. */
export const MAX_STEPS = 24;

export class LiveRunError extends Error {
  readonly status = 409;
}

export interface LiveRunOutcome {
  liveRunId: number;
  status: "finished" | "budget_exhausted" | "error";
  value: unknown;
  steps: number;
  events: Array<{ seq: number; kind: string; payload: Record<string, unknown> }>;
}

export async function runLive(options: {
  attemptId: number;
  problemVersionId: number;
  modelId: string;
  solution: string;
  question: string;
  tools: string[];
  budget: { max_llm_calls: number; max_tool_calls: number };
  model: ModelClient;
  toolRunner?: ToolClient;
}): Promise<LiveRunOutcome> {
  const liveRunId = await open(options.attemptId, options.problemVersionId, options.modelId);

  let state: unknown[] = [];
  let seq = 0;
  const events: LiveRunOutcome["events"] = [];

  const record = async (kind: string, payload: Record<string, unknown>) => {
    seq += 1;
    await db().query(
      `insert into live_run_event (live_run_id, seq, kind, payload) values ($1,$2,$3,$4)`,
      [liveRunId, seq, kind, JSON.stringify(payload)]);
    events.push({ seq, kind, payload });
  };

  for (let step = 0; step < MAX_STEPS; step += 1) {
    const result = await invokeSandbox({
      solution: options.solution,
      input: { question: options.question },
      tools: options.tools,
      budget: options.budget,
      state,
    });

    if (result.status === "error") {
      await close(liveRunId, "error", seq);
      await record("error", { message: result.message ?? "the sandbox failed" });
      return { liveRunId, status: "error", value: null, steps: seq, events };
    }

    if (result.status === "finished") {
      await close(liveRunId, "finished", seq);
      await record("final", { value: result.value ?? null });
      return { liveRunId, status: "finished", value: result.value ?? null, steps: seq, events };
    }

    const action = result.action!;
    // Validate before acting. An action the worker does not recognise is not
    // forwarded to anything that costs money.
    const observation = await perform(action, options, record);
    state = [...(result.state ?? []), observation];
  }

  await close(liveRunId, "budget_exhausted", seq);
  await record("budget_exhausted", { max_steps: MAX_STEPS });
  return { liveRunId, status: "budget_exhausted", value: null, steps: seq, events };
}

async function perform(
  action: Action,
  options: { modelId: string; model: ModelClient; toolRunner?: ToolClient },
  record: (kind: string, payload: Record<string, unknown>) => Promise<void>,
): Promise<unknown> {
  if (action.kind === "llm_call") {
    await record("llm_call", { prompt: action.prompt, call_index: action.call_index });
    const response = await options.model.complete({
      modelId: options.modelId, prompt: action.prompt,
    });
    await record("llm_response", { response });
    return response;
  }

  if (action.kind === "tool_call") {
    await record("tool_call", { tool: action.tool, args: action.args });
    if (!options.toolRunner) {
      const refusal = { error: `no tool named ${action.tool} is available in a live run` };
      await record("observation", { value: refusal });
      return refusal;
    }
    const value = await options.toolRunner.call({ tool: action.tool, args: action.args });
    await record("observation", { value: value as Record<string, unknown> });
    return value;
  }

  const unknown = { error: "the sandbox asked for something the worker does not support" };
  await record("observation", { value: unknown });
  return unknown;
}

async function open(
  attemptId: number, problemVersionId: number, modelId: string,
): Promise<number> {
  const { rows } = await db().query<{ id: string }>(
    `insert into live_run (attempt_id, problem_version_id, model_id)
     values ($1, $2, $3) returning id`,
    [attemptId, problemVersionId, modelId]);
  return Number(rows[0]!.id);
}

async function close(
  liveRunId: number, status: LiveRunOutcome["status"], steps: number,
): Promise<void> {
  await inTransaction(async (client) => {
    await client.query(
      `update live_run set status = $2, steps_used = $3, finished_at = now() where id = $1`,
      [liveRunId, status, steps]);
  });
}

function invokeSandbox(payload: Record<string, unknown>): Promise<StepResult> {
  const venv = path.join(REPO_ROOT, ".venv/bin/python");
  const interpreter = process.env.RUNNER_PYTHON ?? (existsSync(venv) ? venv : "python3");

  return new Promise((resolve, reject) => {
    const child = spawn(interpreter, ["-m", "runner.step_protocol"], {
      cwd: REPO_ROOT,
      env: { ...process.env, PYTHONPATH: REPO_ROOT, PYTHONDONTWRITEBYTECODE: "1" },
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`step protocol exited ${code}: ${err.slice(0, 400)}`));
      try {
        resolve(JSON.parse(out) as StepResult);
      } catch {
        reject(new Error(`step protocol produced no JSON: ${out.slice(0, 300)}`));
      }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

/**
 * The Bedrock client is infrastructure a human deploys. Until then a live run
 * uses this, which is deterministic and costs nothing, so the protocol can be
 * exercised end to end without a credential existing anywhere.
 */
export const scriptedModel = (script: string[]): ModelClient => {
  let index = 0;
  return {
    async complete() {
      const reply = script[Math.min(index, script.length - 1)] ?? "Final Answer: no reply";
      index += 1;
      return reply;
    },
  };
};
