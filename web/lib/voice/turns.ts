/**
 * The follow-up rounds of an interview session, on the server. docs/07
 * section 5a.
 *
 * A turn is one socket connection. The main answer is turn 0 and lives on
 * voice_session, as every other mode's answer does; each follow-up round is a
 * voice_turn row and its own connection, with its own sixty second token
 * carrying `turn: k`. Between two turns the server plans the next round, asks
 * the judge for its words under a deadline or falls back to the authored
 * bank, speaks it in the asking interviewer's voice, and hands the browser
 * the round. The learner has stopped speaking for all of it.
 *
 * The browser names a session and a round number. Everything else, who asks,
 * what kind of question, the words, the voice and the token, is decided here.
 */
import type { PoolClient } from "pg";
import { db, inTransaction } from "../db/pool.ts";
import { inBackground } from "./background.ts";
import { SAMPLE_RATE, socketUrl, tokenSecret } from "./config.ts";
import {
  askForFollowUp, fallbackFor, followUpEvent, kindLabel, personaBlock, planRound,
  type FallbackReason, type Generation, type RoundKind,
} from "./follow-up.ts";
import {
  interviewerOnRecord, membersOf, speakingVoice, type Interviewer,
} from "./interviewers.ts";
import { callJudge, type JudgeCall } from "./judge-call.ts";
import { REPLY_SECONDS } from "./reply.ts";
import { mintVoiceToken } from "./token.ts";
import { speakGenerated, speakLine } from "./tts.ts";

/** docs/07 section 5a: a session whose last round was asked this long ago,
 *  with no reply since, was abandoned, and the scorer closes it. */
export const STALE_INTERVIEW_MINUTES = 15;

/** What the browser receives for a round. */
export type TurnView = {
  turn: number;
  rounds: number;
  interviewer: { slug: string; name: string; title: string };
  /** On this application, streamed from the bucket. Null when no speech is
   *  configured or synthesis failed. */
  audioUrl: string | null;
  /** The question's words, only when audioUrl is null: then the listening
   *  phase shows them, and nothing else ever does. */
  text?: string;
  seconds: number;
  token: string;
  socketUrl: string;
  sampleRate: number;
};

export type RoundOptions = {
  /** The judge. Tests pass a stub; a request takes the configured road. */
  judge?: JudgeCall;
  deadlineMs?: number;
  /** When the request that asked for this round arrived, for gap_ms. */
  receivedAt?: number;
};

export class TurnNotOpen extends Error {
  constructor(message: string, readonly status: number = 409) {
    super(message);
  }
}

type SessionRow = {
  id: string; enrolment_id: string; voice_question_id: string; interviewer_slug: string | null;
  interview_rounds: number | null; resume_claims: string[] | null; transcript: string | null;
  finished_at: Date | null;
};

type TurnRow = {
  id: string; ordinal: number; interviewer_slug: string; kind: RoundKind; depth: number;
  source: "generated" | "authored" | "probe"; question_text: string;
  authored_follow_up_id: string | null; audio_key: string | null; transcript: string | null;
  finished_at: Date | null;
};

const TURN_COLUMNS = `id, ordinal, interviewer_slug, kind, depth, source, question_text,
  authored_follow_up_id, audio_key, transcript, finished_at`;

async function sessionRow(sessionId: number): Promise<SessionRow | null> {
  const { rows } = await db().query<SessionRow>(
    `select id, enrolment_id, voice_question_id, interviewer_slug, interview_rounds, resume_claims,
            transcript, finished_at
       from voice_session where id = $1 and mode = 'interview'`, [sessionId]);
  return rows[0] ?? null;
}

async function turnsOf(sessionId: number): Promise<TurnRow[]> {
  const { rows } = await db().query<TurnRow>(
    `select ${TURN_COLUMNS} from voice_turn where voice_session_id = $1 order by ordinal`, [sessionId]);
  return rows;
}

/** The interviewer a session names and, on a panel, its members. */
async function castOf(slug: string | null): Promise<{ persona: Interviewer; members: Interviewer[] } | null> {
  const persona = await interviewerOnRecord(slug);
  if (!persona) return null;
  return { persona, members: await membersOf(persona) };
}

/** A token for one reply's connection: the session's claims and the turn. */
export function mintTurnToken(claims: { sid: number; eid: number; qid: number; turn: number }): string {
  return mintVoiceToken(
    { sid: String(claims.sid), eid: claims.eid, qid: claims.qid, mode: "interview", turn: claims.turn },
    tokenSecret());
}

async function viewOf(session: SessionRow, turn: TurnRow): Promise<TurnView> {
  const asker = await interviewerOnRecord(turn.interviewer_slug);
  const audioUrl = turn.audio_key
    ? `/api/voice/sessions/${session.id}/turns/${turn.ordinal}/audio` : null;
  return {
    turn: turn.ordinal,
    rounds: session.interview_rounds ?? turn.ordinal,
    interviewer: {
      slug: turn.interviewer_slug,
      name: asker?.name ?? turn.interviewer_slug,
      title: asker?.title ?? "",
    },
    audioUrl,
    ...(audioUrl === null ? { text: turn.question_text } : {}),
    seconds: REPLY_SECONDS,
    token: mintTurnToken({
      sid: Number(session.id), eid: Number(session.enrolment_id),
      qid: Number(session.voice_question_id), turn: turn.ordinal,
    }),
    socketUrl: socketUrl(),
    sampleRate: SAMPLE_RATE,
  };
}

/** Close the interview: the session is finished and the resume's claims go. */
export async function closeInterview(client: PoolClient, sessionId: number): Promise<void> {
  await client.query(
    `update voice_session
        set finished_at = coalesce(finished_at, now()), resume_claims = null, resume_claims_at = null
      where id = $1`,
    [sessionId]);
}

/** Close an interview outside any other transaction. */
export async function endInterview(sessionId: number): Promise<void> {
  await inTransaction((client) => closeInterview(client, sessionId));
}

/**
 * Open round `ordinal`: plan it, ask the judge with a deadline, fall back when
 * the judge does not answer in time with an object the check accepts, speak
 * it, store it, and return what the browser needs. Null when there is no line
 * left to ask, which the validator makes impossible inside five rounds.
 *
 * A second request for the same round, a retry racing the first, finds the
 * row the first wrote and returns that round rather than a second one.
 */
export async function openRound(
  sessionId: number, ordinal: number, options: RoundOptions = {},
): Promise<TurnView | null> {
  const receivedAt = options.receivedAt ?? Date.now();
  const session = await sessionRow(sessionId);
  if (!session || session.finished_at) return null;
  const cast = await castOf(session.interviewer_slug);
  const rounds = session.interview_rounds ?? 0;
  if (!cast || ordinal > rounds) return null;

  const earlier = (await turnsOf(sessionId)).filter((turn) => turn.ordinal < ordinal);
  const claims = Array.isArray(session.resume_claims) ? session.resume_claims : [];
  const plan = planRound({
    ordinal, rounds, cadence: cast.persona.cadence, hasClaims: claims.length > 0,
    earlier: earlier.map((turn) => ({ kind: turn.kind, depth: turn.depth })),
    persona: cast.persona, members: cast.members,
  });

  const question = await db().query<{
    title: string; prompt_text: string; round: string | null; tests: string | null;
  }>("select title, prompt_text, round, tests from voice_question where id = $1",
     [Number(session.voice_question_id)]);
  const names = new Map([cast.persona, ...cast.members].map((person) => [person.slug, person.name]));
  const event = followUpEvent({
    plan, rounds,
    persona: personaBlock(plan.interviewer,
      cast.members.length > 0 ? { chair: cast.members[0]!, members: cast.members } : null),
    question: question.rows[0]!,
    earlier: earlier.map((turn) => ({
      interviewer: names.get(turn.interviewer_slug) ?? turn.interviewer_slug,
      question: turn.question_text,
      answer: turn.transcript ?? "",
    })),
    // What the next question comes from: the main answer, then the last reply.
    transcript: (earlier.length ? earlier.at(-1)!.transcript : session.transcript) ?? "",
    claims,
  });

  const generation = await askForFollowUp(event, plan, options.judge ?? callJudge, options.deadlineMs);
  const line = generation.source === "generated"
    ? { source: "generated" as const, text: generation.text, followUpId: null, targets: generation.targets }
    : await fallbackLine(Number(session.voice_question_id), plan.interviewer, earlier);
  if (!line) return null;

  // Spoken in the asking interviewer's own voice, on a panel the member's.
  // A synthesis that fails leaves the round as text in the listening phase,
  // and the reply goes ahead.
  const voice = await speakingVoice(plan.interviewer);
  let audioKey: string | null = null;
  let synthesisMs: number | null = null;
  if (voice) {
    const started = Date.now();
    try {
      const spoken = line.source === "generated"
        ? await speakGenerated(line.text, voice, sessionId, ordinal)
        : await speakLine(line.text, voice);
      audioKey = spoken?.audioKey ?? null;
      synthesisMs = spoken ? Date.now() - started : null;
    } catch (error) {
      console.warn(`round ${ordinal} of voice session ${sessionId} was not spoken: ${
        error instanceof Error ? error.name : "unknown"}`);
    }
  }

  const { rows } = await db().query<{ id: string }>(
    `insert into voice_turn
       (voice_session_id, ordinal, interviewer_slug, kind, depth, source, question_text,
        authored_follow_up_id, audio_key, generation_ms, synthesis_ms, gap_ms, model_calls,
        input_tokens, output_tokens, fallback_reason, targets)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
     on conflict (voice_session_id, ordinal) do nothing
     returning id`,
    [sessionId, ordinal, plan.interviewer.slug, plan.kind, plan.depth, line.source, line.text,
     line.followUpId, audioKey, generation.generationMs, synthesisMs, Date.now() - receivedAt,
     generation.modelCalls, generation.usage.inputTokens, generation.usage.outputTokens,
     generation.source === "fallback" ? generation.reason : null,
     line.source === "generated" ? line.targets : null]);

  const turn = (await turnsOf(sessionId)).find((candidate) => candidate.ordinal === ordinal)!;
  if (rows[0]) recordLateReply(Number(rows[0].id), generation);
  return viewOf(session, turn);
}

/** The line a round asks when the model did not: the question's next unused
 *  authored follow-up, then the interviewer's next unused probe. */
async function fallbackLine(questionId: number, interviewer: Interviewer, earlier: TurnRow[]) {
  const { rows } = await db().query<{ id: string; text: string }>(
    `select id, text from voice_follow_up
      where voice_question_id = $1 and retired_at is null order by ordinal`, [questionId]);
  const fallback = fallbackFor({
    authored: rows.map((row) => ({ id: Number(row.id), text: row.text })),
    usedAuthored: new Set(earlier.filter((turn) => turn.authored_follow_up_id !== null)
      .map((turn) => Number(turn.authored_follow_up_id))),
    probes: interviewer.stressProbes,
    usedProbes: new Set(earlier.filter((turn) => turn.source === "probe" &&
      turn.interviewer_slug === interviewer.slug).map((turn) => turn.question_text)),
  });
  if (!fallback) return null;
  return fallback.source === "authored"
    ? { source: "authored" as const, text: fallback.text, followUpId: fallback.followUpId, targets: null }
    : { source: "probe" as const, text: fallback.text, followUpId: null, targets: null };
}

/** A reply that arrived after the deadline, measured and never used. */
function recordLateReply(turnId: number, generation: Generation): void {
  if (generation.source !== "fallback" || !generation.late) return;
  const late = generation.late;
  inBackground("recording a late follow-up", async () => {
    const landed = await late;
    if (!landed) return;
    await db().query(
      `update voice_turn
          set late_generation_ms = $2, model_calls = model_calls + $3, input_tokens = $4,
              output_tokens = $5
        where id = $1`,
      [turnId, landed.elapsedMs, landed.modelCalls, landed.usage.inputTokens, landed.usage.outputTokens]);
  });
}

/**
 * The round the browser should be on: the latest asked and not yet answered,
 * else the next one, else null when the interview is over, which closes it.
 * The main answer's finish asks for this, so a retry whose first reply was lost
 * gets the same round back with a fresh token.
 */
export async function pendingRound(sessionId: number, options: RoundOptions = {}): Promise<TurnView | null> {
  const session = await sessionRow(sessionId);
  if (!session || session.finished_at) return null;
  const turns = await turnsOf(sessionId);
  const latest = turns.at(-1);
  if (latest && latest.finished_at === null) return viewOf(session, latest);
  const next = (latest?.ordinal ?? 0) + 1;
  const opened = next <= (session.interview_rounds ?? 0) ? await openRound(sessionId, next, options) : null;
  if (!opened) await endInterview(sessionId);
  return opened;
}

/**
 * Store a reply and move on: the next round, or the close.
 *
 * `close` is Stop and debrief, Next question or the closing tab's beacon: the
 * round ends and the interview with it. The last round closes it too. Nothing
 * here refunds anything, because the main answer is what counted.
 */
export async function finishTurn(
  input: {
    sessionId: number; enrolmentId: number; ordinal: number; transcript: string;
    segments?: Array<{ text: string; startMs: number; endMs: number }>;
    /** How long the reply ran, by the browser's clock. Used only to date
     *  started_at for the measurement, and clamped to the round. */
    replyMs?: number;
    close: boolean;
  },
  options: RoundOptions = {},
): Promise<{ closed: true } | { closed: false; turn: TurnView }> {
  const ended = await inTransaction(async (client) => {
    const { rows } = await client.query<{ finished_at: Date | null; interview_rounds: number | null }>(
      `select finished_at, interview_rounds from voice_session
        where id = $1 and enrolment_id = $2 and mode = 'interview' for update`,
      [input.sessionId, input.enrolmentId]);
    const session = rows[0];
    if (!session) throw new TurnNotOpen("That interview is not yours, or it does not exist.", 404);
    if (session.finished_at) return true;

    const { rowCount } = await client.query(
      `update voice_turn
          set transcript = $3, transcript_segments = $4, finished_at = now(),
              started_at = greatest(asked_at, now() - make_interval(secs => $5::double precision / 1000))
        where voice_session_id = $1 and ordinal = $2 and finished_at is null`,
      [input.sessionId, input.ordinal, input.transcript, JSON.stringify(input.segments ?? []),
       Math.max(0, Math.min(Number(input.replyMs ?? 0), REPLY_SECONDS * 1000 * 2))]);
    if (rowCount === 0) {
      const { rows: asked } = await client.query(
        "select 1 from voice_turn where voice_session_id = $1 and ordinal = $2", [input.sessionId, input.ordinal]);
      if (!asked.length) throw new TurnNotOpen(`Round ${input.ordinal} was never asked in that interview.`);
    }
    if (input.close || input.ordinal >= (session.interview_rounds ?? 0)) {
      await closeInterview(client, input.sessionId);
      return true;
    }
    return false;
  });
  if (ended) return { closed: true };
  const turn = await pendingRound(input.sessionId, options);
  return turn ? { closed: false, turn } : { closed: true };
}

/**
 * The scorer loop's sweep: interview sessions whose main answer was saved and
 * whose last round was asked or answered more than fifteen minutes ago, which
 * a closed tab with no beacon leaves open. Closing one lets the scorer score
 * it. Returns how many were closed.
 */
export async function closeStaleInterviews(minutes: number = STALE_INTERVIEW_MINUTES): Promise<number> {
  const { rowCount } = await db().query(
    `update voice_session s
        set finished_at = now(), resume_claims = null, resume_claims_at = null
      where s.mode = 'interview' and s.finished_at is null and s.answer_finished_at is not null
        and greatest(s.answer_finished_at,
                     (select max(coalesce(t.finished_at, t.asked_at)) from voice_turn t
                       where t.voice_session_id = s.id))
            < now() - make_interval(mins => $1)`,
    [minutes]);
  return rowCount ?? 0;
}

/**
 * The rounds the rubric judge reads with the main answer: every why and
 * stress round the learner replied to, in order, labelled with who asked.
 * Rounds drawn from the pasted claims are left out here, structurally, so
 * nothing the learner pasted reaches a score. The judge refuses an event
 * that carries one, as a second line of defence.
 */
export async function scoredRounds(sessionId: number): Promise<Array<{
  interviewer: string; kind: "why" | "stress"; depth: number; question: string; answer: string;
}>> {
  const { rows } = await db().query<{
    name: string | null; interviewer_slug: string; kind: "why" | "stress"; depth: number;
    question_text: string; transcript: string | null;
  }>(
    `select i.name, t.interviewer_slug, t.kind, t.depth, t.question_text, t.transcript
       from voice_turn t left join voice_interviewer i on i.slug = t.interviewer_slug
      where t.voice_session_id = $1 and t.finished_at is not null and t.kind in ('why', 'stress')
      order by t.ordinal`,
    [sessionId]);
  return rows.map((row) => ({
    interviewer: row.name ?? row.interviewer_slug,
    kind: row.kind,
    depth: row.depth,
    question: row.question_text,
    answer: row.transcript ?? "",
  }));
}

/** A round as the debrief shows it. Faculty and admins also see how it was
 *  made; the learner sees who asked and what. */
export type DebriefRound = {
  ordinal: number;
  interviewer: { slug: string; name: string; title: string };
  kind: RoundKind;
  depth: number;
  kindLabel: string;
  question: string;
  answer: string | null;
  staff?: {
    source: string; fallbackReason: string | null; generationMs: number | null;
    synthesisMs: number | null; gapMs: number | null; targets: string | null;
  };
};

export async function debriefRounds(sessionId: number, staff: boolean): Promise<DebriefRound[]> {
  const { rows } = await db().query<{
    ordinal: number; interviewer_slug: string; kind: RoundKind; depth: number; source: string;
    question_text: string; transcript: string | null; fallback_reason: string | null;
    generation_ms: number | null; synthesis_ms: number | null; gap_ms: number | null;
    targets: string | null;
  }>(
    `select ordinal, interviewer_slug, kind, depth, source, question_text, transcript,
            fallback_reason, generation_ms, synthesis_ms, gap_ms, targets
       from voice_turn where voice_session_id = $1 order by ordinal`,
    [sessionId]);
  const people = new Map<string, Interviewer | null>();
  for (const row of rows) {
    if (!people.has(row.interviewer_slug)) {
      people.set(row.interviewer_slug, await interviewerOnRecord(row.interviewer_slug));
    }
  }
  return rows.map((row) => {
    const asker = people.get(row.interviewer_slug) ?? null;
    return {
      ordinal: row.ordinal,
      interviewer: { slug: row.interviewer_slug, name: asker?.name ?? row.interviewer_slug,
                     title: asker?.title ?? "" },
      kind: row.kind,
      depth: row.depth,
      kindLabel: kindLabel(row.kind, row.depth),
      question: row.question_text,
      answer: row.transcript,
      ...(staff ? {
        staff: {
          source: row.source, fallbackReason: row.fallback_reason, generationMs: row.generation_ms,
          synthesisMs: row.synthesis_ms, gapMs: row.gap_ms, targets: row.targets,
        },
      } : {}),
    };
  });
}

/**
 * Speak the lines a round could fall back on before any round needs them, so
 * a fallback plays at once: the question's authored follow-ups and the
 * probes, in the voice of every interviewer who could ask a round. Through
 * the spoken-line cache, so it costs nothing after the first session on a
 * question and an interviewer, and nothing at all with no bucket.
 */
export async function warmFallbackLines(sessionId: number): Promise<number> {
  const session = await sessionRow(sessionId);
  const cast = session ? await castOf(session.interviewer_slug) : null;
  if (!session || !cast) return 0;
  const askers = cast.members.length > 0 ? cast.members : [cast.persona];
  const { rows } = await db().query<{ text: string }>(
    `select text from voice_follow_up
      where voice_question_id = $1 and retired_at is null order by ordinal`,
    [Number(session.voice_question_id)]);
  let spoken = 0;
  for (const asker of askers) {
    const voice = await speakingVoice(asker);
    if (!voice) continue;
    for (const text of [...rows.map((row) => row.text), ...asker.stressProbes]) {
      if (await speakLine(text, voice)) spoken += 1;
    }
  }
  return spoken;
}

export type { FallbackReason };
