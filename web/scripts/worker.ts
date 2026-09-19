/**
 * The background worker, for running the platform outside AWS.
 *
 * Nothing grades without this. The submit route queues a message and returns
 * 202; this drains the queue, runs the battery, judges what needs a model and
 * commits the verdict. In the deployed shape those stages are Lambdas behind
 * SQS, and this is the process that stands in for them on a laptop, in a demo
 * and on a single box.
 *
 *   npm run worker            loop until interrupted
 *   npm run worker -- --once  one pass of every stage, then exit
 *
 * The runner subprocess executes learner code, so run this where that is
 * acceptable: your own machine, or a container you are willing to lose. It is
 * not the sandbox the runner Lambda gives you.
 */
import { dispatchOnce, reapExpiredLeases } from "../lib/queue/dispatcher.ts";
import { judgeOnce } from "../lib/queue/judge-worker.ts";
import { runOnce, writeResultsOnce } from "../lib/queue/runner-worker.ts";
import { closeDb } from "../lib/db/pool.ts";

/** Long enough that an idle worker is quiet, short enough that a learner
 *  watching the results pane does not notice the wait. */
const IDLE_MS = 1000;

interface Pass {
  dispatched: number;
  ran: number;
  judged: number;
  written: number;
  reaped: number;
}

/** One pass of every stage, in the order a submission travels through them. */
export async function pass(): Promise<Pass> {
  const dispatched = await dispatchOnce();
  const ran = await runOnce();
  const judged = await judgeOnce();
  const written = await writeResultsOnce();
  const reaped = await reapExpiredLeases();
  return { dispatched, ran, judged, written, reaped };
}

function moved(result: Pass): boolean {
  return Object.values(result).some((n) => n > 0);
}

async function loop(): Promise<void> {
  let stop = false;
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      stop = true;
      console.log(`\n${signal}, finishing the pass in flight`);
    });
  }

  console.log("worker started, polling for submissions");
  while (!stop) {
    try {
      const result = await pass();
      if (moved(result)) console.log(new Date().toISOString(), JSON.stringify(result));
    } catch (error) {
      // A stage that throws must not take the worker down with it, or one bad
      // submission stops grading for everyone until somebody notices.
      console.error("pass failed:", (error as Error).message);
    }
    if (!stop) await new Promise((resolve) => setTimeout(resolve, IDLE_MS));
  }
  console.log("worker stopped");
}

if (import.meta.filename === process.argv[1]) {
  if (process.argv.includes("--once")) {
    console.log(JSON.stringify(await pass()));
  } else {
    await loop();
  }
  await closeDb();
}
