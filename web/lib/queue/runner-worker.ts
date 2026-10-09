/**
 * The trusted side of the runner.
 *
 * It takes a submission message off the queue, assembles the event, the
 * submission's kind included, hands it to the battery and puts the result on
 * the results queue. The battery itself never touches the database, which is
 * the separation docs/03 section 7 and .claude/rules/01 both rest on: the
 * component that executes learner code has no database credential and no
 * model credential.
 *
 * Three roads to the same handler, runner.handler.lambda_handler, chosen in
 * this order:
 *
 *   RUNNER_FUNCTION  the deployed runner Lambda, by a signed Invoke. Learner
 *                    code runs there and never on this host.
 *   RUNNER_ENDPOINT  the runtime interface emulator in a local container.
 *   neither          a subprocess on this host, for a laptop.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { db } from "../db/pool.ts";
import { deleteMessage, receive, send, type QueueMessage } from "./shim.ts";
import { invokeLambda, type Invoker } from "./lambda.ts";

const REPO_ROOT = path.join(import.meta.dirname, "..", "..", "..");

export interface WorkerOptions {
  /** Falls back to the repo's virtualenv, then to python3. */
  python?: string;
  endpoint?: string;
  /** The runner Lambda. Falls back to RUNNER_FUNCTION. */
  functionName?: string;
  /** How the function is called. Tests pass their own. */
  lambda?: Invoker;
}

export async function runOnce(options: WorkerOptions = {}): Promise<number> {
  const messages = await receive("submissions", 5);
  if (runnerFunction(options)) {
    // Each submission is its own invocation, so a batch runs side by side
    // rather than queueing behind the slowest. Locally the battery is a
    // process on this machine, and five at once on a laptop is not worth it.
    await Promise.all(messages.map((message) => handle(message, options)));
  } else {
    for (const message of messages) {
      await handle(message, options);
    }
  }
  return messages.length;
}

function runnerFunction(options: WorkerOptions): string | undefined {
  return options.functionName ?? process.env.RUNNER_FUNCTION;
}

async function handle(message: QueueMessage, options: WorkerOptions): Promise<void> {
  const submissionId = Number(message.body["submission_id"]);
  const event = await buildEvent(submissionId);

  let result: Record<string, unknown>;
  try {
    result = event
      ? await invoke(event, options)
      : { verdict: "error", message: "the submission or its problem version is missing",
          consumes_allowance: false };
  } catch (error) {
    // An infrastructure failure is an error verdict, which under docs/03
    // section 8 does not consume the learner's allowance.
    result = {
      verdict: "error",
      message: "The runner did not complete. Your attempt was not counted. Try again.",
      detail: (error as Error).message,
      consumes_allowance: false,
    };
  }

  await send("results", {
    submission_id: submissionId,
    lease_token: message.body["lease_token"],
    fencing_token: message.body["fencing_token"],
    body_sha256: message.body["body_sha256"],
    result,
  });
  await deleteMessage(message.id);
}

async function buildEvent(submissionId: number): Promise<Record<string, unknown> | null> {
  const { rows } = await db().query<{
    body: string; kind: string; source_yaml: string; solved_at: Date | null; hints_used: number;
  }>(
    `select s.body, s.kind::text as kind, v.source_yaml, a.solved_at, a.hints_used
       from submission s
       join problem_version v on v.id = s.problem_version_id
       join attempt a on a.id = s.attempt_id
      where s.id = $1`, [submissionId]);
  const row = rows[0];
  if (!row) return null;

  const { parse } = await import("yaml");
  return {
    submission_id: submissionId,
    // The kind decides the batteries: a Run executes the public cases and the
    // steps, a Submit the full battery (docs/00 section 4). It is read from
    // the submission row, which createSubmission wrote in the transaction
    // that spent the allowance and copied into the outbox payload, so the
    // battery that runs is the one that was paid for. A message that lost
    // its copy cannot turn a Run into a Submit.
    kind: row.kind,
    problem: parse(row.source_yaml),
    solution: row.body,
    already_passed: row.solved_at !== null,
    // docs/03 section 5: every score loses 5 points per hint revealed, capped
    // at 25. The count is the attempt's, read here on the trusted side as the
    // judge worker reads it, and never anything the browser sent. Until 8
    // October 2026 this event carried none and the runner took 0, so no code
    // score carried the penalty.
    hints_revealed: row.hints_used,
  };
}

async function invoke(
  event: Record<string, unknown>, options: WorkerOptions,
): Promise<Record<string, unknown>> {
  const functionName = runnerFunction(options);
  if (functionName) return (options.lambda ?? invokeLambda)(functionName, event);

  const endpoint = options.endpoint ?? process.env.RUNNER_ENDPOINT;
  if (endpoint) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event),
    });
    if (!response.ok) throw new Error(`runner returned ${response.status}`);
    return (await response.json()) as Record<string, unknown>;
  }
  return invokeLocally(event, options.python);
}

function invokeLocally(
  event: Record<string, unknown>, python?: string,
): Promise<Record<string, unknown>> {
  const interpreter = python ?? resolvePython();
  return new Promise((resolve, reject) => {
    const child = spawn(interpreter, ["-m", "runner.invoke"], {
      cwd: REPO_ROOT,
      env: { ...process.env, PYTHONPATH: REPO_ROOT, PYTHONDONTWRITEBYTECODE: "1" },
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`runner exited ${code}: ${err.slice(0, 500)}`));
      try {
        resolve(JSON.parse(out) as Record<string, unknown>);
      } catch {
        reject(new Error(`runner produced no JSON: ${out.slice(0, 300)}`));
      }
    });
    child.stdin.end(JSON.stringify(event));
  });
}

/**
 * Which Python runs the battery. The repo virtualenv when there is one, and
 * python3 otherwise, because CI installs the runner's dependencies against the
 * interpreter on PATH and has no virtualenv. RUNNER_PYTHON overrides both.
 */
function resolvePython(): string {
  const explicit = process.env.RUNNER_PYTHON;
  if (explicit) return explicit;
  const venv = path.join(REPO_ROOT, ".venv/bin/python");
  return existsSync(venv) ? venv : "python3";
}

/** Drain the results queue into the database. */
export async function writeResultsOnce(): Promise<number> {
  const { writeResult } = await import("./result-writer.ts");
  const messages = await receive("results", 10);
  for (const message of messages) {
    await writeResult({
      submission_id: Number(message.body["submission_id"]),
      lease_token: String(message.body["lease_token"]),
      fencing_token: Number(message.body["fencing_token"]),
      body_sha256: String(message.body["body_sha256"]),
      result: message.body["result"] as Record<string, unknown>,
    });
    await deleteMessage(message.id);
  }
  return messages.length;
}
