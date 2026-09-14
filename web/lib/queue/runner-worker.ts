/**
 * The trusted side of the runner.
 *
 * It takes a submission message off the queue, assembles the event, hands it
 * to the battery and puts the result on the results queue. The battery itself
 * never touches the database, which is the separation docs/03 section 7 and
 * .claude/rules/01 both rest on: the component that executes learner code has
 * no database credential and no model credential.
 *
 * Locally the battery runs as a subprocess. Set RUNNER_ENDPOINT to the runtime
 * interface emulator and the same event goes over HTTP to the container
 * instead, which is the deployed shape.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { db } from "../db/pool.ts";
import { deleteMessage, receive, send, type QueueMessage } from "./shim.ts";

const REPO_ROOT = path.join(import.meta.dirname, "..", "..", "..");

export interface WorkerOptions {
  /** Falls back to the repo's virtualenv, then to python3. */
  python?: string;
  endpoint?: string;
}

export async function runOnce(options: WorkerOptions = {}): Promise<number> {
  const messages = await receive("submissions", 5);
  for (const message of messages) {
    await handle(message, options);
  }
  return messages.length;
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
  const { rows } = await db().query<{ body: string; source_yaml: string; solved_at: Date | null }>(
    `select s.body, v.source_yaml, a.solved_at
       from submission s
       join problem_version v on v.id = s.problem_version_id
       join attempt a on a.id = s.attempt_id
      where s.id = $1`, [submissionId]);
  const row = rows[0];
  if (!row) return null;

  const { parse } = await import("yaml");
  return {
    submission_id: submissionId,
    problem: parse(row.source_yaml),
    solution: row.body,
    already_passed: row.solved_at !== null,
  };
}

async function invoke(
  event: Record<string, unknown>, options: WorkerOptions,
): Promise<Record<string, unknown>> {
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
