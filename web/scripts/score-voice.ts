/**
 * Score finished voice sessions.
 *
 * Runs alongside the dispatcher and the result writer. Each pass takes the
 * sessions that have finished and have no result, sends each to the judge
 * Lambda, and writes the score back. Safe to run on a loop: a session is
 * claimed by its attempt counter, and one already scored is not picked up.
 *
 * Each pass also deletes learner audio past its thirty days and records it,
 * which is docs/07 section 9's retention promise.
 *
 * And two sweeps for interview mode, docs/07 section 5a, before the scoring
 * so a session they close is scored in the same pass: an interview whose last
 * round was asked more than fifteen minutes ago with no reply since is
 * closed, which a tab closed without its beacon leaves open; and any resume
 * claims on a session started more than a day ago are deleted. They run here
 * rather than inside the scorer, which keeps the scoring modules free of
 * anything to do with a resume (tests/fairness.test.ts).
 */
import { closeDb } from "../lib/db/pool.ts";
import { markExpiredAudio } from "../lib/voice/audio.ts";
import { scoreVoiceOnce } from "../lib/voice/judge.ts";
import { sweepResumeClaims } from "../lib/voice/resume.ts";
import { closeStaleInterviews } from "../lib/voice/turns.ts";

const INTERVAL_MS = Number(process.env.VOICE_SCORE_INTERVAL_MS ?? 5_000);

async function main(): Promise<void> {
  const once = process.argv.includes("--once");
  console.log("voice scorer started, polling for finished answers");
  for (;;) {
    try {
      const stale = await closeStaleInterviews();
      if (stale > 0) console.log(`closed ${stale} interview${stale === 1 ? "" : "s"} left open by a closed tab`);
      const swept = await sweepResumeClaims();
      if (swept > 0) console.log(`deleted the resume claims of ${swept} session${swept === 1 ? "" : "s"} past a day`);
      // Each session it takes is logged as scored or not scored, with the
      // judge's reason. A count here read "scored 5" when all five failed.
      await scoreVoiceOnce();
      const expired = await markExpiredAudio();
      if (expired > 0) console.log(`deleted ${expired} recording${expired === 1 ? "" : "s"} past retention`);
    } catch (error) {
      // The same rule as the submission worker: a pass that throws, a database
      // restarting under it for example, must not take the scorer down with
      // it, or every answer waits unscored until somebody notices.
      console.error(`voice scoring pass failed, trying again in ${INTERVAL_MS / 1000}s:`,
                    error instanceof Error ? error.message : error);
      if (once) process.exitCode = 1;
    }
    if (once) break;
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
  }
  await closeDb();
}

if (import.meta.filename === process.argv[1]) {
  await main();
}
