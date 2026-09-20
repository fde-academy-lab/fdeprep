/**
 * The bridge to panelist 2's encoder.
 *
 * A Python subprocess, invoked exactly the way the test battery already is
 * through RUNNER_PYTHON. docs/10 section 5 put panelist 2 in the worker rather
 * than the judge because its cost profile is CPU-bound with no network, and
 * the judge's is the opposite.
 *
 * Never throws. An encoder that cannot run is a panelist reporting unavailable,
 * which the panel already degrades around. Turning that into an exception here
 * would make an outage look like a bug.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.join(import.meta.dirname, "..", "..", "..");
const TIMEOUT_MS = Number(process.env["EMBED_TIMEOUT_MS"] ?? 20_000);

/**
 * Which weights produced a vector, recorded on every row.
 *
 * Vectors from different models are not comparable, so a change here has to
 * invalidate the index rather than silently mix with it. The revision is the
 * guarantee that a learner graded in March and one graded in September were
 * read by the same model.
 */
export const EMBEDDING_MODEL = "all-MiniLM-L6-v2@1110a243";

export type Embed = (texts: string[]) => Promise<EmbedResult>;

export type EmbedResult =
  | { ok: true; vectors: number[][] }
  | { ok: false; reason: string };

/** Same resolution the runner and judge workers use: the repo venv, then PATH. */
function interpreter(): string {
  const explicit = process.env["RUNNER_PYTHON"];
  if (explicit) return explicit;
  const venv = path.join(REPO_ROOT, ".venv", "bin", "python");
  return existsSync(venv) ? venv : "python3";
}

export async function embed(texts: string[]): Promise<EmbedResult> {
  if (!texts.length) return { ok: true, vectors: [] };

  return new Promise<EmbedResult>((resolve) => {
    const child = spawn(interpreter(), ["-m", "embed.cli"], {
      cwd: REPO_ROOT,
      env: { ...process.env, PYTHONPATH: REPO_ROOT },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let out = "";
    let err = "";
    // A hung encoder is an unavailable panelist rather than a stuck worker.
    // Without this the whole queue stops behind one submission.
    const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);

    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", (chunk) => { err += chunk; });

    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, reason: `spawn_failed: ${error.message}` });
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (signal === "SIGKILL") return resolve({ ok: false, reason: "timeout" });
      if (code !== 0) {
        return resolve({ ok: false, reason: `exit_${code}: ${err.trim().slice(0, 200)}` });
      }
      try {
        const parsed = JSON.parse(out) as
          { ok: true; vectors: number[][] } | { ok: false; reason: string };
        resolve(parsed.ok
          ? { ok: true, vectors: parsed.vectors }
          : { ok: false, reason: parsed.reason });
      } catch {
        resolve({ ok: false, reason: "unparsable_response" });
      }
    });

    child.stdin.end(JSON.stringify({ texts }));
  });
}

/** Vectors are L2 normalised by the encoder, so cosine is the dot product. */
export function similarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) return 0;
  let total = 0;
  for (let i = 0; i < a.length; i += 1) total += a[i]! * b[i]!;
  return total;
}
