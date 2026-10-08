/**
 * A pasted resume, turned into claims for one interview session. docs/07
 * sections 5a and 9, as amended for S14.2.
 *
 * | Rule | Here |
 * |---|---|
 * | Pasted text only, at most 12,000 characters, sent once when an interview
 *   session opens. | checkResume, and the session route reads it only in
 *   interview mode. |
 * | The text goes to the judge once, inside nonced delimiters labelled data, and
 *   comes back as at most twelve claims. | extractClaims; the judge's
 *   voice_resume_claims event does the delimiting. |
 * | The text is never written: not to a table, a log line, an audit row or an
 *   error report. | It is a parameter and nothing else. Every failure below
 *   logs a fixed sentence and never an error's message, which could quote the
 *   event. |
 * | Eight seconds, then the session opens without claims and says so. |
 *   extractClaims. |
 * | The claims are deleted when the session closes, and after a day by the
 *   scorer's sweep. | closeInterview in turns.ts, and sweepResumeClaims. |
 * | Nothing from the resume reaches a score. | Resume rounds are left out of
 *   the scorer's event, and tests/fairness.test.ts keeps the word out of the
 *   scoring modules. |
 */
import { db } from "../db/pool.ts";
import { callJudge, type JudgeCall } from "./judge-call.ts";
import { RESUME_MAX_CHARS, RESUME_RULE } from "./resume-rule.ts";

export { RESUME_MAX_CHARS, RESUME_RULE };
export const RESUME_DEADLINE_MS = 8_000;
/** The sweep's limit: an abandoned session keeps its claims no longer than this. */
export const RESUME_KEEP_HOURS = 24;
export const CLAIMS_MAX = 12;
export const CLAIM_MAX_WORDS = 25;

/** What the learner is told when the claims did not arrive. */
export const RESUME_NOT_READ = "The resume could not be read in time, so this session runs without it.";

/**
 * Contact and identity details, dropped from any claim whatever the judge
 * returned. The judge is told to leave them out and drops them itself; this
 * is the control that still holds if a reply carries one. The same pattern
 * as judge/schema.py.
 */
const PERSONAL =
  /(@|https?:\/\/|www\.|\+?\d[\d\s().-]{7,}\d|\b(date of birth|dob|passport|aadhaar|pan)\b)/i;

export class ResumeRefused extends Error {
  readonly status = 400;
}

/** The paste to send, trimmed, or null for none. Refuses one over the limit
 *  with a sentence that names the length and never the words. */
export function checkResume(text: unknown): string | null {
  if (typeof text !== "string" || !text.trim()) return null;
  if (text.length > RESUME_MAX_CHARS) {
    throw new ResumeRefused(
      `The resume is ${text.length.toLocaleString("en-GB")} characters and the limit is ` +
      `${RESUME_MAX_CHARS.toLocaleString("en-GB")}. Paste the parts about your work and start ` +
      "again. Nothing was started or counted.");
  }
  return text.trim();
}

/** Claims as the session keeps them: strings, at most twelve, each at most
 *  twenty-five words, none holding contact or identity details. */
export function keptClaims(claims: unknown): string[] {
  if (!Array.isArray(claims)) return [];
  return claims
    .filter((claim): claim is string => typeof claim === "string")
    .map((claim) => claim.trim())
    .filter((claim) => claim && claim.split(/\s+/).length <= CLAIM_MAX_WORDS && !PERSONAL.test(claim))
    .slice(0, CLAIMS_MAX);
}

/**
 * The resume's claims, or none and a note for the learner.
 *
 * The judge has `deadlineMs`. Late, failed, or answering with no list, the
 * session opens without claims; the note says so and a resume round becomes
 * a why.
 */
export async function extractClaims(
  text: string,
  options: { judge?: JudgeCall; deadlineMs?: number } = {},
): Promise<{ claims: string[]; note: string | null }> {
  const judge = options.judge ?? callJudge;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"late">((resolve) => {
    timer = setTimeout(() => resolve("late"), options.deadlineMs ?? RESUME_DEADLINE_MS);
  });
  const event = { artefact_type: "voice_resume_claims", deadline_ms: RESUME_DEADLINE_MS, text };
  const call = judge(event, controller.signal).catch(() => "failed" as const);

  const reply = await Promise.race([call, late]);
  clearTimeout(timer);
  if (reply === "late") {
    controller.abort();
    console.warn("resume claims: the judge did not answer within the deadline, so the session opens without them");
    return { claims: [], note: RESUME_NOT_READ };
  }
  if (reply === "failed" || reply["status"] !== "ok" || !Array.isArray(reply["claims"])) {
    console.warn("resume claims: the judge could not read the resume, so the session opens without them");
    return { claims: [], note: RESUME_NOT_READ };
  }
  return { claims: keptClaims(reply["claims"]), note: null };
}

/** The scorer loop's sweep: claims on any session started more than a day
 *  ago, which an abandoned tab would otherwise keep. Returns how many. */
export async function sweepResumeClaims(hours: number = RESUME_KEEP_HOURS): Promise<number> {
  const { rowCount } = await db().query(
    `update voice_session set resume_claims = null, resume_claims_at = null
      where resume_claims is not null and started_at < now() - make_interval(hours => $1)`,
    [hours]);
  return rowCount ?? 0;
}
