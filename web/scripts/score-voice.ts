/**
 * Score finished voice sessions.
 *
 * Runs alongside the dispatcher and the result writer. Each pass takes the
 * sessions that have finished and have no result, sends each to the judge
 * Lambda, and writes the score back. Safe to run on a loop: a session is
 * claimed by its attempt counter, and one already scored is not picked up.
 */
import { closeDb } from "../lib/db/pool.ts";
import { scoreVoiceOnce } from "../lib/voice/judge.ts";

const INTERVAL_MS = Number(process.env.VOICE_SCORE_INTERVAL_MS ?? 5_000);

async function main(): Promise<void> {
  const once = process.argv.includes("--once");
  for (;;) {
    const scored = await scoreVoiceOnce();
    if (scored > 0) console.log(`scored ${scored} voice session${scored === 1 ? "" : "s"}`);
    if (once) break;
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
  }
  await closeDb();
}

if (import.meta.filename === process.argv[1]) {
  await main();
}
