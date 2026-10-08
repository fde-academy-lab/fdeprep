/**
 * Opening a voice session: the row first, then the token that reaches it.
 *
 * Everything the socket will act on is decided here, on the server, and
 * signed into the token. The browser receives a URL and an opaque string; it
 * cannot name an enrolment, a question, a mode or a session, which is what
 * keeps the consent gate and the caps real rather than advisory.
 *
 * Interview mode, docs/07 section 5a, adds three things here. The cap on
 * follow-up rounds is resolved now, from the question or the policy default
 * for its difficulty, and written on the row, so a content change never
 * changes a running session. A pasted resume becomes claims before the row
 * is written, and the claims go into the same transaction that opens it; the
 * text itself is a parameter and nothing else. And once the row exists the
 * judge is warmed and the fallback lines are spoken, in the background of
 * this request, so the first round does not wait on either.
 */
import { db, inTransaction } from "../db/pool.ts";
import { logOnce } from "../log-once.ts";
import { allowanceFor, consume, RateLimitError, voiceScope } from "../policy/caps.ts";
import type { Difficulty } from "../policy/tiers.ts";
import { interviewRoundsFor } from "../policy/voice.ts";
import { inBackground } from "./background.ts";
import { SAMPLE_RATE, socketUrl, tokenSecret, VoiceNotConfigured } from "./config.ts";
import { requireConsent } from "./consent.ts";
import { InterviewerNotFound, resolveInterviewer } from "./interviewers.ts";
import { callJudge, judgeIsDeployed, type JudgeCall } from "./judge-call.ts";
import { checkResume, extractClaims } from "./resume.ts";
import type { VoiceMode } from "./run.ts";
import { mintVoiceToken } from "./token.ts";
import { warmFallbackLines } from "./turns.ts";

export type { VoiceMode };
export { VoiceNotConfigured };

export type StartedSession = {
  sessionId: number;
  token: string;
  socketUrl: string;
  sampleRate: number;
  /** Interview mode only. */
  interview?: {
    /** The cap on follow-up rounds this session runs with. */
    rounds: number;
    /** How many claims the pasted resume gave, 0 when none was pasted or it
     *  could not be read. */
    resumeClaims: number;
    /** A sentence for the learner when a pasted resume could not be read. */
    resumeNote: string | null;
  };
};

/**
 * Whether graded voice sessions can open on this deployment at all.
 *
 * Asked by the page before it draws a Start button, so a learner on a
 * deployment without the socket meets a practice screen instead of a
 * configuration error meant for whoever runs the platform.
 */
export function voiceReadiness(): { ready: boolean; missing: string[] } {
  const missing = ["VOICE_SOCKET_URL", "VOICE_TOKEN_SECRET"].filter((name) => !process.env[name]);
  return { ready: missing.length === 0, missing };
}

/**
 * The screens say spoken answers are not switched on and name nothing; this
 * line tells whoever runs the deployment which variables to set, once per
 * process.
 */
export function logVoiceNotSetUp(missing: readonly string[]): void {
  logOnce(`Graded voice is off: the web app needs ${missing.join(" and ")}, from the voice stack ` +
          "in infra/. docs/05 has the deploy steps.");
}

/** The cap on follow-up rounds an interview session on this question runs
 *  with. The policy module decides from the difficulty when the question does
 *  not say; nothing here reads the difficulty. */
export async function interviewRoundsForQuestion(questionId: number): Promise<number> {
  const { rows } = await db().query<{ difficulty: Difficulty; interview_rounds: number | null }>(
    "select difficulty, interview_rounds from voice_question where id = $1", [questionId]);
  const row = rows[0];
  if (!row) throw new Error(`No voice question ${questionId}.`);
  return interviewRoundsFor({ difficulty: row.difficulty, interviewRounds: row.interview_rounds });
}

/**
 * Open a session: consent, configuration, the cap, then the row.
 *
 * The allowance is claimed here, in the same transaction as the row, so a
 * refused cap leaves nothing behind and two tabs cannot both take the last
 * answer of the day. docs/07 section 10 names the caps; lib/policy/caps.ts
 * says which one each mode spends. An answer that ends before it says
 * anything gives the unit back when it finishes, in lib/voice/persist.ts.
 *
 * `capped: false` is for the faculty transport check alone, which carries no
 * answer and is not scored.
 */
export async function startVoiceSession(
  input: {
    enrolmentId: number;
    cohortId: number;
    voiceQuestionId: number;
    mode: VoiceMode;
    capped?: boolean;
    /** The slug the browser sent, resolved here. Absent means the question's
     *  first interviewer. */
    interviewerSlug?: string | null;
    /** Interview mode only: the pasted resume, at most 12,000 characters.
     *  Read once, sent once to the judge, and never written. */
    resume?: string | null;
  },
  options: { judge?: JudgeCall; resumeDeadlineMs?: number } = {},
): Promise<StartedSession> {
  // Order matters. Every refusal costs nothing and leaves no row behind.
  await requireConsent(input.enrolmentId);
  const url = socketUrl();
  const signing = tokenSecret();
  const interviewer = await sessionInterviewer(input.voiceQuestionId, input.interviewerSlug);

  const interview = input.mode === "interview";
  const rounds = interview ? await interviewRoundsForQuestion(input.voiceQuestionId) : null;
  // Refused for its length before anything else is spent on it.
  const resume = interview ? checkResume(input.resume) : null;
  let claims: string[] = [];
  let resumeNote: string | null = null;
  if (resume !== null) {
    // An allowance already spent is refused before the paste costs a model
    // call. The claim below is still the gate.
    if (input.capped !== false) {
      const left = await allowanceFor({ enrolmentId: input.enrolmentId, scope: voiceScope(input.mode) });
      if (left.max !== null && left.remaining <= 0) {
        throw new RateLimitError(left.scope, left.max, left.resetInS ?? left.windowS);
      }
    }
    ({ claims, note: resumeNote } = await extractClaims(resume, {
      judge: options.judge, deadlineMs: options.resumeDeadlineMs,
    }));
  }

  const sessionId = await inTransaction(async (client) => {
    if (input.capped !== false) {
      await consume(client, { enrolmentId: input.enrolmentId, scope: voiceScope(input.mode) });
    }
    const { rows } = await client.query<{ id: string }>(
      `insert into voice_session
         (enrolment_id, voice_question_id, cohort_id, mode, spent_allowance, interviewer_slug,
          interview_rounds, resume_claims, resume_claims_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, case when $8::jsonb is null then null else now() end)
       returning id`,
      [input.enrolmentId, input.voiceQuestionId, input.cohortId, input.mode,
       input.capped !== false, interviewer, rounds,
       claims.length > 0 ? JSON.stringify(claims) : null],
    );
    return Number(rows[0]!.id);
  });

  if (interview) {
    // A deployed judge that has not run for a while starts cold, and the
    // first round would always fall back. A ping now warms it while the
    // learner gives the main answer. A local subprocess needs no warming.
    if (judgeIsDeployed()) {
      const judge = options.judge ?? callJudge;
      inBackground("warming the judge", () => judge({ artefact_type: "ping" }));
    }
    inBackground("speaking the fallback lines", () => warmFallbackLines(sessionId));
  }

  return {
    sessionId,
    token: mintVoiceToken(
      {
        sid: String(sessionId),
        eid: input.enrolmentId,
        qid: input.voiceQuestionId,
        mode: input.mode,
      },
      signing,
    ),
    socketUrl: url,
    sampleRate: SAMPLE_RATE,
    ...(interview && rounds !== null
      ? { interview: { rounds, resumeClaims: claims.length, resumeNote } } : {}),
  };
}

/**
 * Who asks, decided on the server. A slug the browser named has to be a
 * published interviewer, or the session is refused before anything is
 * claimed. With none named it is the question's first interviewer that is
 * still published, and null for a question that names none, such as the
 * development fixture.
 */
export async function sessionInterviewer(
  questionId: number, slug: string | null | undefined,
): Promise<string | null> {
  if (slug) return (await resolveInterviewer(slug)).slug;
  const { rows } = await db().query<{ interviewers: string[] }>(
    "select interviewers from voice_question where id = $1", [questionId]);
  for (const candidate of rows[0]?.interviewers ?? []) {
    try {
      return (await resolveInterviewer(candidate)).slug;
    } catch (error) {
      if (!(error instanceof InterviewerNotFound)) throw error;
    }
  }
  return null;
}
