/**
 * Work a request starts and does not wait for: warming the judge, speaking
 * the fallback lines before they are needed, and recording a follow-up that
 * arrived after its deadline. docs/07 section 5a.
 *
 * Inside a request, Next's after() runs the task once the response is sent
 * and keeps the function alive for it, on hosts that would otherwise stop at
 * the response. Outside one, a script or a test calling a route directly,
 * after() throws, and the task runs as a detached promise that
 * settleBackground() can wait for, which is how the tests see what it wrote.
 *
 * A task that fails is logged by its label and the error's kind and message
 * and nothing else. None of these tasks carries learner text, and the label is
 * how an operator finds the step.
 */
import { after } from "next/server";

const pending = new Set<Promise<void>>();

export function inBackground(label: string, task: () => Promise<unknown>): void {
  const run = async () => {
    try {
      await task();
    } catch (error) {
      console.warn(`${label} failed: ${error instanceof Error ? `${error.name}: ${error.message}` : "unknown"}`);
    }
  };
  try {
    after(run);
    return;
  } catch {
    // Outside a request scope: a script or a test.
  }
  const promise = run();
  pending.add(promise);
  void promise.finally(() => pending.delete(promise));
}

/** Wait for every detached task, including ones those tasks started. */
export async function settleBackground(): Promise<void> {
  while (pending.size > 0) {
    await Promise.allSettled([...pending]);
  }
}
