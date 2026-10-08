/**
 * The trusted side of the judge.
 *
 * It takes a message off the judgements lane, runs the static gate here in the
 * application, and only then hands the submission to the judge Lambda. The
 * Lambda has Bedrock permission and no code execution; this worker has the
 * database and no model credential. Neither half can do the other's job, which
 * is the whole point of there being two.
 *
 * Three roads to the same handler, judge.handler.lambda_handler, chosen in this
 * order: JUDGE_FUNCTION, the deployed judge Lambda by a signed Invoke, so this
 * host holds no model credential; JUDGE_ENDPOINT, the runtime interface
 * emulator in a local container; and otherwise a subprocess on this host.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { db } from "../db/pool.ts";
import { staticGate, type GateProblem, type StaticGate } from "../gate/index.ts";
import type { Embed } from "../eval/embed.ts";
import { reevaluationBacklog } from "../eval/record.ts";
import { reevaluatePartial } from "../eval/reevaluate.ts";
import { deleteMessage, receive, send, type QueueMessage } from "./shim.ts";
import { invokeLambda, type Invoker } from "./lambda.ts";

const REPO_ROOT = path.join(import.meta.dirname, "..", "..", "..");
const LEASE_EXTENSION_S = 120;

export interface JudgeOptions {
  python?: string;
  endpoint?: string;
  /** The judge Lambda. Falls back to JUDGE_FUNCTION. */
  functionName?: string;
  /** How the function is called. Tests pass their own. */
  lambda?: Invoker;
  /** Injected by tests that do not want to spawn a process at all. */
  invoke?: (event: Record<string, unknown>) => Promise<Record<string, unknown>>;
  /** Partial evaluations one tick re-runs at most. Falls back to REEVALUATIONS_PER_TICK. */
  reevaluationsPerTick?: number;
  /** Which partial evaluations are waiting before their next re-run. Tests pass their own. */
  backoff?: ReevaluationBackoff;
  /** Panelist 2's encoder for a re-run. Tests pass a stub. */
  embed?: Embed;
}

export async function judgeOnce(options: JudgeOptions = {}): Promise<number> {
  const messages = await receive("judgements", 5);
  if (judgeFunction(options)) {
    // Side by side, as in the runner worker: each judgement is its own
    // invocation, and a probe run takes long enough that one at a time would
    // queue a whole session's design answers behind each other.
    await Promise.all(messages.map((message) => handle(message, options)));
  } else {
    for (const message of messages) {
      await handle(message, options);
    }
  }

  // After the new work, so a learner waiting on a first verdict never queues
  // behind a re-run. A drain that fails costs the drain and never this tick's
  // judgements, which are already written.
  try {
    await drainReevaluations(options);
  } catch (error) {
    console.error("re-evaluation drain failed:", (error as Error).message);
  }
  return messages.length;
}

/** At most this many partial evaluations are re-run in one tick. */
export const REEVALUATIONS_PER_TICK = 3;

/**
 * How long a partial evaluation waits after a re-run that could not complete
 * it, doubled after each one up to the ceiling. The judge or the encoder is
 * still down, and asking every second would only add load to whatever is
 * failing. The ceiling keeps a recovered panelist's backlog cleared well
 * inside the hour the learner was told.
 */
const RETRY_AFTER_MS = 60_000;
const RETRY_CEILING_MS = 15 * 60_000;

/** Submission id to how many re-runs have failed in a row and when the next may start. */
export type ReevaluationBackoff = Map<number, { failures: number; until: number }>;

const waiting: ReevaluationBackoff = new Map();

/**
 * Pay off the re-evaluation backlog, a few per tick. docs/10 section 9.
 *
 * A partial evaluation is a promise of a free re-run, and analytics/ reports
 * the backlog as the debt. This is what pays it: oldest first, at most the
 * bound per tick, each through reevaluatePartial, which appends a complete
 * evaluation or writes nothing. No allowance is read or spent anywhere on this
 * path. Returns how many it completed.
 *
 * The wait between failed attempts lives in this process, so a restarted
 * worker tries each one once more straight away. That costs one call per
 * waiting submission, and keeping the wait in the database would cost a write
 * per failed attempt for the life of an outage.
 */
export async function drainReevaluations(options: JudgeOptions = {}): Promise<number> {
  const perTick = options.reevaluationsPerTick ?? REEVALUATIONS_PER_TICK;
  if (perTick < 1) return 0;
  const backoff = options.backoff ?? waiting;
  const now = Date.now();

  // Wide enough that the waiting ones cannot crowd out the ones that are due.
  const window = perTick + backoff.size;
  const backlog = await reevaluationBacklog(window);
  if (backlog.length < window) {
    // The whole backlog came back, so a waiting id missing from it was paid
    // off some other way.
    for (const id of backoff.keys()) if (!backlog.includes(id)) backoff.delete(id);
  }
  const due = backlog.filter((id) => (backoff.get(id)?.until ?? 0) <= now).slice(0, perTick);

  let completed = 0;
  for (const submissionId of due) {
    const outcome = await reevaluatePartial(submissionId, {
      rejudge: (id) => rejudge(id, options),
      embed: options.embed,
    }).catch((error: Error) => {
      // One submission's failure waits like any other, and never stops the rest.
      console.error(`re-evaluation of submission ${submissionId} failed:`, error.message);
      return { status: "unchanged" as const, reason: error.message };
    });

    if (outcome.status === "written") {
      completed += 1;
      backoff.delete(submissionId);
      continue;
    }
    const failures = (backoff.get(submissionId)?.failures ?? 0) + 1;
    backoff.set(submissionId, {
      failures,
      until: now + Math.min(RETRY_AFTER_MS * 2 ** (failures - 1), RETRY_CEILING_MS),
    });
  }
  return completed;
}

/**
 * Judge a graded submission's answer again, for the drain or a regrade.
 *
 * The rubric only. Probes are a battery that passed or failed when the
 * submission did, they are already on the record, and no judge prompt reads
 * them, so the event carries the problem without them and a re-run costs one
 * model call rather than two per probe. The static gate runs here again
 * exactly as it does for a first judgement, so an answer it now stops never
 * reaches the model.
 */
export async function rejudge(
  submissionId: number, options: JudgeOptions = {},
): Promise<Record<string, unknown>> {
  const built = await judgeEvent(submissionId, 1);
  if ("result" in built) return built.result;
  return invoke({ ...built.event, problem: { ...built.event.problem, probes: [] } }, options);
}

function judgeFunction(options: JudgeOptions): string | undefined {
  return options.functionName ?? process.env.JUDGE_FUNCTION;
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
  const built = await judgeEvent(submissionId, attempt);
  if ("result" in built) return built.result;
  void message;
  return invoke(built.event, options);
}

type JudgeEvent = Record<string, unknown> & { problem: Record<string, unknown> };

/**
 * The event the judge receives for a submission, or the result to record
 * without one: a missing submission, or a static gate that already failed.
 * Shared by the first judgement and by rejudge, so a re-run judges exactly
 * what the first one did.
 */
async function judgeEvent(
  submissionId: number, attempt: number,
): Promise<{ event: JudgeEvent } | { result: Record<string, unknown> }> {
  const { rows } = await db().query<JudgeRow>(
    `select s.body, s.kind::text as kind, v.source_yaml, v.defence_criterion,
            a.solved_at, a.hints_used
       from submission s
       join problem_version v on v.id = s.problem_version_id
       join attempt a on a.id = s.attempt_id
      where s.id = $1`, [submissionId]);
  const row = rows[0];
  if (!row) {
    return { result: { verdict: "error", message: "the submission is missing",
                       consumes_allowance: false, model_calls: 0 } };
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
    return { result: failedStatically(gate, problem, row.hints_used) };
  }

  return {
    event: {
      submission_id: submissionId,
      artefact_type: artefact,
      problem: problem as unknown as Record<string, unknown>,
      body: row.body,
      already_passed: row.solved_at !== null,
      hints_revealed: row.hints_used,
      attempt,
      static_gate: gate,
    },
  };
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

/**
 * The road to the judge: the deployed function when JUDGE_FUNCTION is set, the
 * runtime interface emulator when JUDGE_ENDPOINT is, and a subprocess
 * otherwise.
 *
 * Exported so the voice scorer reaches the same function the same way rather
 * than growing a second road to it. docs/07 section 6 scores a spoken answer
 * with the same judge.
 */
export async function invoke(
  event: Record<string, unknown>, options: JudgeOptions,
): Promise<Record<string, unknown>> {
  if (options.invoke) return options.invoke(event);

  const functionName = judgeFunction(options);
  if (functionName) return (options.lambda ?? invokeLambda)(functionName, event);

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
