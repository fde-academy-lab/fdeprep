/**
 * Opening a voice session: the row first, then the token that reaches it.
 *
 * Everything the socket will act on is decided here, on the server, and
 * signed into the token. The browser receives a URL and an opaque string; it
 * cannot name an enrolment, a question, a mode or a session, which is what
 * keeps the consent gate and the caps real rather than advisory.
 */
import { inTransaction } from "../db/pool.ts";
import { consume, voiceScope } from "../policy/caps.ts";
import { requireConsent } from "./consent.ts";
import { mintVoiceToken } from "./token.ts";

export type VoiceMode = "guided" | "unguided" | "pressure";

export type StartedSession = {
  sessionId: number;
  token: string;
  socketUrl: string;
  sampleRate: number;
};

export class VoiceNotConfigured extends Error {
  readonly status = 503;
}

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

function socketUrl(): string {
  const url = process.env.VOICE_SOCKET_URL;
  if (!url) {
    throw new VoiceNotConfigured(
      "The voice socket is not configured. Set VOICE_SOCKET_URL to the WebSocket endpoint " +
        "before opening a session.",
    );
  }
  return url;
}

function secret(): string {
  const value = process.env.VOICE_TOKEN_SECRET;
  if (!value) {
    throw new VoiceNotConfigured(
      "The voice socket is not configured. Set VOICE_TOKEN_SECRET to the same value the " +
        "authorizer holds before opening a session.",
    );
  }
  return value;
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
export async function startVoiceSession(input: {
  enrolmentId: number;
  cohortId: number;
  voiceQuestionId: number;
  mode: VoiceMode;
  capped?: boolean;
}): Promise<StartedSession> {
  // Order matters. Every refusal costs nothing and leaves no row behind.
  await requireConsent(input.enrolmentId);
  const url = socketUrl();
  const signing = secret();

  const sessionId = await inTransaction(async (client) => {
    if (input.capped !== false) {
      await consume(client, { enrolmentId: input.enrolmentId, scope: voiceScope(input.mode) });
    }
    const { rows } = await client.query<{ id: string }>(
      `insert into voice_session
         (enrolment_id, voice_question_id, cohort_id, mode, spent_allowance)
       values ($1, $2, $3, $4, $5) returning id`,
      [input.enrolmentId, input.voiceQuestionId, input.cohortId, input.mode,
       input.capped !== false],
    );
    return Number(rows[0]!.id);
  });

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
    sampleRate: 16_000,
  };
}
