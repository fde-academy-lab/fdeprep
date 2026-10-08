/**
 * The judge, reached from a request. docs/07 section 5a.
 *
 * Interview mode asks the judge for a follow-up between two turns, and turns
 * a pasted resume into claims when a session opens, both inside a route.
 * lib/queue/judge-worker.ts has the same roads and the voice scorer keeps
 * using it, but it works out the repository's path from import.meta.dirname as
 * it loads, which Next's server bundle leaves undefined
 * (tests/server-bundle.test.ts), so no route may load it.
 *
 * The roads, in the same order:
 *
 * 1. JUDGE_FUNCTION: the deployed judge Lambda by a signed Invoke. The only
 *    road a deployment takes, and the one that keeps the model credential off
 *    this host: the judge function holds it and this host holds
 *    lambda:InvokeFunction.
 * 2. JUDGE_ENDPOINT: the runtime interface emulator in a local container.
 * 3. A subprocess, `python -m judge.invoke`, run from the repository, which is
 *    the web application's parent directory on every machine that runs it from
 *    web/. A developer's road, as it is for the scorer.
 *
 * Every road takes an abort signal, so a caller can stop waiting.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { invokeLambda } from "../queue/lambda.ts";

export type JudgeCall = (
  event: Record<string, unknown>, signal?: AbortSignal,
) => Promise<Record<string, unknown>>;

export class NoJudgeRoad extends Error {}

/** Whether the judge is a deployed function, which is the one road worth
 *  warming before a session needs it. */
export function judgeIsDeployed(): boolean {
  return Boolean(process.env.JUDGE_FUNCTION);
}

export const callJudge: JudgeCall = async (event, signal) => {
  const functionName = process.env.JUDGE_FUNCTION;
  if (functionName) return invokeLambda(functionName, event, { abortSignal: signal });

  const endpoint = process.env.JUDGE_ENDPOINT;
  if (endpoint) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event),
      signal,
    });
    if (!response.ok) throw new Error(`judge returned ${response.status}`);
    return (await response.json()) as Record<string, unknown>;
  }
  return inSubprocess(event, signal);
};

/** The repository, found from the working directory: web/ when the app or a
 *  script runs from there, or the repository itself. */
function repositoryRoot(): string | null {
  for (const candidate of [path.resolve(process.cwd(), ".."), process.cwd()]) {
    if (existsSync(path.join(candidate, "judge", "invoke.py"))) return candidate;
  }
  return null;
}

function inSubprocess(
  event: Record<string, unknown>, signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const root = repositoryRoot();
  if (!root) {
    return Promise.reject(new NoJudgeRoad(
      "No judge is configured: set JUDGE_FUNCTION, or run the app from the repository's web/."));
  }
  const venv = path.join(root, ".venv", "bin", "python");
  const python = process.env.RUNNER_PYTHON ?? (existsSync(venv) ? venv : "python3");
  return new Promise((resolve, reject) => {
    const child = spawn(python, ["-m", "judge.invoke"], {
      cwd: root,
      env: { ...process.env, PYTHONPATH: root, PYTHONDONTWRITEBYTECODE: "1" },
    });
    const stop = () => child.kill();
    signal?.addEventListener("abort", stop, { once: true });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      signal?.removeEventListener("abort", stop);
      if (signal?.aborted) return reject(new Error("the judge was abandoned"));
      if (code !== 0) return reject(new Error(`judge exited ${code}: ${err.slice(0, 300)}`));
      try {
        resolve(JSON.parse(out) as Record<string, unknown>);
      } catch {
        reject(new Error("judge produced no JSON"));
      }
    });
    child.stdin.end(JSON.stringify(event));
  });
}
