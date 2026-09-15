/**
 * Opening a voice session: the row first, then the token that reaches it.
 *
 * Everything the socket will act on is decided here, on the server, and
 * signed into the token. The browser receives a URL and an opaque string; it
 * cannot name an enrolment, a question, a mode or a session, which is what
 * keeps the consent gate and the caps real rather than advisory.
 */
import { db } from "../db/pool.ts";
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

export async function startVoiceSession(input: {
  enrolmentId: number;
  cohortId: number;
  voiceQuestionId: number;
  mode: VoiceMode;
}): Promise<StartedSession> {
  // Order matters. The refusal costs nothing and leaves no row behind.
  await requireConsent(input.enrolmentId);
  const url = socketUrl();
  const signing = secret();

  const { rows } = await db().query<{ id: string }>(
    `insert into voice_session (enrolment_id, voice_question_id, cohort_id, mode)
     values ($1, $2, $3, $4) returning id`,
    [input.enrolmentId, input.voiceQuestionId, input.cohortId, input.mode],
  );
  const sessionId = Number(rows[0]!.id);

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
