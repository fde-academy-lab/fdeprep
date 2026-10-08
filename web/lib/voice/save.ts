/**
 * The cockpit's three calls to the server, and what each failure tells the
 * learner. docs/07 sections 7 and 10.
 *
 * Before this the cockpit treated any reply to Stop as saved: a 500 showed
 * "Answer recorded" and a link to a debrief that did not exist, and an error
 * page in place of JSON threw out of Start with nothing on screen. Each call
 * here reads the reply with lib/http/reply.ts, so a status always survives,
 * and returns a result the cockpit renders rather than an exception it has to
 * remember to catch.
 *
 * Saving is the one worth retrying. The answer exists only in this tab until
 * the server has it, and a moment's outage should not cost a learner what
 * they said. Opening is not retried, because a second open would claim a
 * second unit of the allowance if the first had in fact landed.
 *
 * Browser-safe: the imports below are a pure formatter and types, which the
 * compiler erases.
 */
import { readReply } from "../http/reply.ts";
import { clock } from "./clock.ts";
import type { TimelineIn } from "./persist.ts";
import type { CloseReason } from "./protocol.ts";
import type { VoiceMode } from "./run.ts";
import type { StartedSession } from "./start.ts";

/** `fetch`, or a test's stand-in for it. */
export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/** What the finish route takes. The segment shape is written out rather than
 *  imported from delivery.ts, which tests/fairness.test.ts keeps to the
 *  debrief and the scorer. */
export type Answer = {
  transcript: string;
  segments: { text: string; startMs: number; endMs: number }[];
  timeline: TimelineIn;
};

/** Three tries, a second and then three seconds apart: long enough to ride
 *  out a restart of the web process, short enough that a learner watching
 *  "Saving" is told something within five seconds. */
export const SAVE_WAITS_MS = [1_000, 3_000];

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function openSession(
  fetcher: Fetcher,
  /** The interviewer is a slug the server resolves, or absent for the
   *  question's first. */
  ask: { mode: VoiceMode; question: string; interviewer?: string },
): Promise<{ ok: true; started: StartedSession } | { ok: false; message: string }> {
  let response: Response;
  try {
    response = await fetcher("/api/voice/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(ask),
    });
  } catch {
    return {
      ok: false,
      message: "The answer did not start: this browser could not reach the server. " +
        "Check the connection, then press Start the answer again.",
    };
  }

  const reply = await readReply<StartedSession>(response);
  const started = reply.body;
  if (reply.ok && started && typeof started.sessionId === "number" &&
      typeof started.token === "string" && typeof started.socketUrl === "string") {
    return { ok: true, started };
  }
  if (reply.message) return { ok: false, message: reply.message };
  return {
    ok: false,
    message: reply.ok
      ? "The answer did not start: the server sent back something other than a session. " +
        "Reload the page, then press Start the answer again."
      : `The answer did not start: the server answered ${reply.status}. Try again in a ` +
        "minute, or type the answer instead.",
  };
}

/**
 * Send the finished answer, trying again on a failure that might pass.
 *
 * A 409 counts as saved. The route answers it for a session that is already
 * finished, and in the cockpit that means an earlier try reached the server
 * and its reply was lost on the way back: the answer is there.
 *
 * A refusal in the 400s is not tried again, because the same request would be
 * refused the same way. A 401 is the session ending, which the learner can
 * fix in another tab without losing this one.
 */
export async function saveAnswer(
  fetcher: Fetcher,
  sessionId: number,
  answer: Answer,
  options: { sleep?: (ms: number) => Promise<void> } = {},
): Promise<{ saved: true } | { saved: false; message: string }> {
  const sleep = options.sleep ?? wait;
  let lastStatus: number | null = null;

  for (let attempt = 0; attempt <= SAVE_WAITS_MS.length; attempt += 1) {
    if (attempt > 0) await sleep(SAVE_WAITS_MS[attempt - 1]!);

    let response: Response;
    try {
      response = await fetcher(`/api/voice/sessions/${sessionId}/finish`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(answer),
      });
    } catch {
      lastStatus = null;
      continue;
    }
    if (response.ok || response.status === 409) return { saved: true };

    lastStatus = response.status;
    if (response.status === 401) {
      return {
        saved: false,
        message: "Your session ended before the answer reached the server. The answer is " +
          "still in this tab: sign in again in a new tab, then press Save again here.",
      };
    }
    if (response.status < 500) {
      const reply = await readReply(response);
      return {
        saved: false,
        message: `The server refused the answer with ${response.status}` +
          `${reply.message ? ` (${reply.message})` : ""}. Saving again would be refused the ` +
          "same way, so type the answer instead.",
      };
    }
  }

  return {
    saved: false,
    message: lastStatus === null
      ? "This browser could not reach the server. The answer is still in this tab, so press " +
        "Save again once the connection is back."
      : `The server answered ${lastStatus} three times. The answer is still in this tab: press ` +
        "Save again in a minute, and if that fails too, type the answer instead so it is not " +
        "lost.",
  };
}

/**
 * Store the playback copy. docs/07 section 7.
 *
 * Silent when it works and silent when this deployment keeps no recordings,
 * which is every developer machine: the debrief replays on its own clock
 * then, and there is nothing for the learner to do. A failure says so,
 * because the debrief will offer no audio and the learner should know why.
 */
export async function uploadRecording(
  fetcher: Fetcher,
  sessionId: number,
  recording: Blob,
): Promise<{ stored: boolean; message: string | null }> {
  const failed = "Your answer is saved. The recording was not stored, so the debrief replays " +
    "your answer on its own clock without audio.";
  try {
    const response = await fetcher(`/api/voice/sessions/${sessionId}/audio`, {
      method: "POST",
      headers: { "content-type": recording.type || "audio/webm" },
      body: recording,
    });
    const reply = await readReply<{ stored?: boolean }>(response);
    if (!reply.ok) return { stored: false, message: failed };
    return { stored: reply.body?.stored === true, message: null };
  } catch {
    return { stored: false, message: failed };
  }
}

/**
 * What to tell a learner whose socket closed while they were still answering.
 *
 * The socket says why before it closes, when it can. Whatever the reason, the
 * finals already heard are in the tab, so the next action is the same: save
 * them, or type the answer. The note carries no transcript text, which docs/07
 * section 3 keeps off the screen while the learner is answering.
 */
export function socketLostNote(reason: CloseReason | null, atMs: number): string {
  const at = clock(atMs);
  const kept = "What you said before then is kept: press Stop and debrief to save it, or " +
    "type the answer instead.";
  switch (reason) {
    case "idle":
      return `The transcriber closed at ${at} because no audio reached it from the ` +
        `microphone. ${kept}`;
    case "ceiling":
      return `The session reached its time limit and closed at ${at}. ${kept}`;
    case "failed":
      return `The transcriber failed at ${at}, so nothing after that is being heard. ${kept}`;
    default:
      return `The connection to the transcriber dropped at ${at}, so nothing after that is ` +
        `being heard. ${kept}`;
  }
}
