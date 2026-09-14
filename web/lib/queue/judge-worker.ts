/**
 * The trusted side of the judge.
 *
 * It takes a message off the judgements lane, runs the static gate here in the
 * application, and only then hands the submission to the judge Lambda. The
 * Lambda has Bedrock permission and no code execution; this worker has the
 * database and no model credential. Neither half can do the other's job, which
 * is the whole point of there being two.
 *
 * Locally the judge runs as a subprocess. Set JUDGE_ENDPOINT to the runtime
 * interface emulator and the same event goes over HTTP to the container, which
 * is the deployed shape.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { db } from "../db/pool.ts";
import { staticGate, type GateProblem, type StaticGate } from "../gate/index.ts";
import { deleteMessage, receive, send, type QueueMessage } from "./shim.ts";

const REPO_ROOT = path.join(import.meta.dirname, "..", "..", "..");
const LEASE_EXTENSION_S = 120;

export interface JudgeOptions {
  python?: string;
  endpoint?: string;
  /** Injected by tests that do not want to spawn a process at all. */
  invoke?: (event: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

export async function judgeOnce(options: JudgeOptions = {}): Promise<number> {
  const messages = await receive("judgements", 5);
  for (const message of messages) {
    await handle(message, options);
  }
  return messages.length;
}

async function handle(message: QueueMessage, options: JudgeOptions): Promise<void> {
  const submissionId = Number(message.body["submission_id"]);
  const attempt = Number(message.body["judge_attempt"] ?? 1);

  let result: Record<string, unknown>;
  try {
    result = await evaluate(submissionId, attempt, message, options);
  } catch (error) {
    // docs/03 section 8: an infrastructure failure is an error verdict and
    // does not consume the learner's allowance.
    result = {
      verdict: "error",
      message: "The judge did not complete. Your attempt was not counted. Try again.",
      detail: (error as Error).message,
      consumes_allowance: false,
      model_calls: 0,
    };
  }

  // docs/03 section 4.2: a probe that disagreed with itself is requeued once
  // rather than scored. Nothing is written to the results lane, so the
  // submission stays non-terminal and the allowance stays spent-but-refundable
  // until a verdict actually lands.
  if (result["requeue"] === true && attempt < 2) {
    await requeue(submissionId, message, attempt + 1);
    await deleteMessage(message.id);
    return;
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

interface JudgeRow {
  body: string;
  source_yaml: string;
  solved_at: Date | null;
  hints_used: number;
  kind: string;
  defence_criterion: { label: string; weight: number } | null;
}

async function evaluate(
  submissionId: number, attempt: number, message: QueueMessage, options: JudgeOptions,
): Promise<Record<string, unknown>> {
  const { rows } = await db().query<JudgeRow>(
    `select s.body, s.kind::text as kind, v.source_yaml, v.defence_criterion,
            a.solved_at, a.hints_used
       from submission s
       join problem_version v on v.id = s.problem_version_id
       join attempt a on a.id = s.attempt_id
      where s.id = $1`, [submissionId]);
  const row = rows[0];
  if (!row) {
    return { verdict: "error", message: "the submission is missing",
             consumes_allowance: false, model_calls: 0 };
  }

  const problem = parse(row.source_yaml) as GateProblem & {
    defence_criterion?: { label: string; weight: number };
  };
  const artefact = row.kind === "defence" ? "defence" : problem.artefact_type;

  // The criterion is derived at import from the authored defence_question, so
  // it comes from the column rather than being derived a second time here.
  if (artefact === "defence" && row.defence_criterion) {
    problem.defence_criterion = row.defence_criterion;
  }
  const gate: StaticGate = artefact === "defence"
    ? { status: "pass", checks: [] }
    : staticGate(problem, row.body);

  // Acceptance criterion 1. A submission whose static gate failed never
  // reaches the judge, so the call count is zero rather than small.
  if (gate.status !== "pass") {
    return failedStatically(gate, problem, row.hints_used);
  }

  const event = {
    submission_id: submissionId,
    artefact_type: artefact,
    problem,
    body: row.body,
    already_passed: row.solved_at !== null,
    hints_revealed: row.hints_used,
    attempt,
    static_gate: gate,
  };

  void message;
  return invoke(event, options);
}

function failedStatically(
  gate: StaticGate, problem: GateProblem, hints: number,
): Record<string, unknown> {
  void hints;
  return {
    verdict: "fail",
    score: 0,
    gates: {
      static: gate,
      probes: { status: "skipped", passed: 0,
                total: (problem as { probes?: unknown[] }).probes?.length ?? 0, cases: [] },
      rubric: { status: "skipped", passed: 0, total: 0, cases: [] },
    },
    model_calls: 0,
    consumes_allowance: true,
    requeue: false,
  };
}

async function requeue(
  submissionId: number, message: QueueMessage, nextAttempt: number,
): Promise<void> {
  // The lease and the fencing token are kept, so the compare-and-set on the
  // eventual result still holds. Only the clock is pushed out, because the
  // reaper would otherwise mark an in-flight retry orphaned.
  await db().query(
    `update submission
        set lease_expires_at = now() + make_interval(secs => $2)
      where id = $1 and verdict is null`,
    [submissionId, LEASE_EXTENSION_S]);

  await db().query(
    `insert into runner_event (submission_id, level, message, detail)
     values ($1, 'warn', 'probe disagreement, requeued', $2)`,
    [submissionId, JSON.stringify({ attempt: nextAttempt })]);

  await send("judgements", { ...message.body, judge_attempt: nextAttempt });
}

async function invoke(
  event: Record<string, unknown>, options: JudgeOptions,
): Promise<Record<string, unknown>> {
  if (options.invoke) return options.invoke(event);

  const endpoint = options.endpoint ?? process.env.JUDGE_ENDPOINT;
  if (endpoint) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event),
    });
    if (!response.ok) throw new Error(`judge returned ${response.status}`);
    return (await response.json()) as Record<string, unknown>;
  }
  return invokeLocally(event, options.python);
}

function invokeLocally(
  event: Record<string, unknown>, python?: string,
): Promise<Record<string, unknown>> {
  const interpreter = python ?? resolvePython();
  return new Promise((resolve, reject) => {
    const child = spawn(interpreter, ["-m", "judge.invoke"], {
      cwd: REPO_ROOT,
      env: { ...process.env, PYTHONPATH: REPO_ROOT, PYTHONDONTWRITEBYTECODE: "1" },
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`judge exited ${code}: ${err.slice(0, 500)}`));
      try {
        resolve(JSON.parse(out) as Record<string, unknown>);
      } catch {
        reject(new Error(`judge produced no JSON: ${out.slice(0, 300)}`));
      }
    });
    child.stdin.end(JSON.stringify(event));
  });
}

/** Same resolution as the runner worker: RUNNER_PYTHON, then the repo
 * virtualenv, then python3, because CI has no virtualenv. */
function resolvePython(): string {
  const explicit = process.env.RUNNER_PYTHON;
  if (explicit) return explicit;
  const venv = path.join(REPO_ROOT, ".venv/bin/python");
  return existsSync(venv) ? venv : "python3";
}
