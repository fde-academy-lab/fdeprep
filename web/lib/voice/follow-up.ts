/**
 * Interview mode's follow-up rounds: what each round asks for, the judge's
 * words for it under a deadline, and the authored fallback. docs/07 section
 * 5a.
 *
 * The server plans every round before it calls anything. The interviewer's
 * cadence names the kind of each round, why, stress or resume, and a why
 * climbs a five-level ladder, so the pattern of the questioning is policy and
 * the model supplies only the words and the thread it pulls on. The model has
 * four seconds. When it is late, fails, or answers with something the check
 * below refuses, the question's next unused authored follow-up is asked, then
 * the interviewer's own next unused probe, and their audio already exists
 * because the session spoke them when it opened.
 *
 * Nothing here runs while the learner speaks: a round is planned and asked
 * between two turns, after a reply has ended. docs/07 section 12 item 4.
 */
import { MAX_INTERVIEW_ROUNDS } from "../policy/voice.ts";
import type { CadenceKind, Interviewer } from "./interviewers.ts";
import type { JudgeCall } from "./judge-call.ts";

export type RoundKind = CadenceKind;
export type RoundPlan = { ordinal: number; kind: RoundKind; depth: number; interviewer: Interviewer };

/** The five levels of why. Named here so the debrief, the prompt and the
 *  tests spell them the same way. */
export const WHY_LEVELS = ["specify", "evidence", "mechanism", "alternative", "limit"] as const;

/** docs/07 section 5a: four seconds for the model, inside a six second gap. */
export const FOLLOW_UP_DEADLINE_MS = 4_000;

/** How long a reply that missed the deadline is still awaited, so what it
 *  would have cost is measured. Past this the call is abandoned. */
export const LATE_REPLY_CEILING_MS = 30_000;

/** The reply check, the same bounds judge/schema.py holds the model to. */
export const FOLLOW_UP_MAX_WORDS = 45;
export const FOLLOW_UP_MAX_CHARS = 320;
export const TARGETS_MAX_CHARS = 160;

export class RoundOutOfRange extends Error {}

/**
 * The kind, the level of why and the interviewer of round `ordinal`.
 *
 * 1. The kind is the cadence's entry for the round. A resume slot in a
 *    session with no claims is a why.
 * 2. A why is one level past the highest so far, up to five. A stress probe
 *    or a resume question is level 0 and does not move the ladder.
 * 3. On a panel, round k is asked by members[k % members.length], so the chair
 *    reads the question and the rounds rotate through the others and back to
 *    the chair. The cadence is the panel's own.
 * 4. There is no round past the session's cap, and the cap is at most five.
 */
export function planRound(input: {
  /** 1-based. */
  ordinal: number;
  /** The session's cap. */
  rounds: number;
  /** The interviewer's five entries. */
  cadence: RoundKind[];
  hasClaims: boolean;
  earlier: { kind: RoundKind; depth: number }[];
  /** The person, or the panel. */
  persona: Interviewer;
  /** The panel's members, chair first. Empty for a person. */
  members: Interviewer[];
}): RoundPlan {
  const { ordinal } = input;
  if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > input.rounds ||
      ordinal > MAX_INTERVIEW_ROUNDS) {
    throw new RoundOutOfRange(`There is no round ${ordinal} in a session of ${input.rounds}.`);
  }
  const slot = input.cadence[ordinal - 1] ?? "why";
  const kind: RoundKind = slot === "resume" && !input.hasClaims ? "why" : slot;
  const reached = input.earlier.reduce((highest, round) => Math.max(highest, round.depth), 0);
  const depth = kind === "why" ? Math.min(WHY_LEVELS.length, reached + 1) : 0;
  const interviewer = input.members.length > 0
    ? input.members[ordinal % input.members.length]!
    : input.persona;
  return { ordinal, kind, depth, interviewer };
}

/** How the debrief names a round's kind, in plain words. */
export function kindLabel(kind: RoundKind, depth: number): string {
  if (kind === "why") return `why, level ${depth}`;
  if (kind === "stress") return "stress probe";
  return "from your resume, not scored";
}

/** Who is asking, as the judge's event carries it. On a panel, the member
 *  asking, and the chair and the others by name. */
export function personaBlock(
  interviewer: Interviewer, panel: { chair: Interviewer; members: Interviewer[] } | null,
) {
  return {
    slug: interviewer.slug,
    name: interviewer.name,
    role: interviewer.role,
    listens_for: interviewer.listensFor,
    follow_up_style: interviewer.followUpStyle,
    stress_probes: interviewer.stressProbes,
    panel: panel
      ? {
          chair: panel.chair.name,
          others: panel.members
            .filter((member) => member.slug !== panel.chair.slug && member.slug !== interviewer.slug)
            .map((member) => member.name),
        }
      : null,
  };
}

/**
 * The voice_follow_up event, as plan section 4.1 and the judge define it.
 * `transcript` is what the next question has to come from: the main answer
 * for round 1, the last reply after that. The claims go only with a resume
 * round, so a why or a stress probe never sees the resume.
 */
export function followUpEvent(input: {
  plan: RoundPlan;
  rounds: number;
  persona: ReturnType<typeof personaBlock>;
  question: { title: string; prompt_text: string; round: string | null; tests: string | null };
  earlier: Array<{ interviewer: string; question: string; answer: string }>;
  transcript: string;
  claims: string[];
  deadlineMs?: number;
}): Record<string, unknown> {
  return {
    artefact_type: "voice_follow_up",
    deadline_ms: input.deadlineMs ?? FOLLOW_UP_DEADLINE_MS,
    persona: input.persona,
    question: input.question,
    ask: { kind: input.plan.kind, depth: input.plan.depth, round: input.plan.ordinal, rounds: input.rounds },
    rounds: input.earlier,
    transcript: input.transcript,
    claims: input.plan.kind === "resume" ? input.claims : [],
  };
}

export type Usage = { inputTokens: number | null; outputTokens: number | null };
export type FallbackReason = "timeout" | "error" | "rejected";
export type LateReply = { elapsedMs: number; modelCalls: number; usage: Usage };

export type Generation =
  | { source: "generated"; text: string; targets: string; generationMs: number; modelCalls: number;
      usage: Usage }
  | { source: "fallback"; reason: FallbackReason; generationMs: number | null; modelCalls: number;
      usage: Usage; late: Promise<LateReply | null> | null };

const NO_USAGE: Usage = { inputTokens: null, outputTokens: null };

function usageOf(reply: Record<string, unknown>): Usage {
  const usage = reply["usage"] as { input_tokens?: unknown; output_tokens?: unknown } | null | undefined;
  if (!usage || typeof usage !== "object") return NO_USAGE;
  const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
  return { inputTokens: count(usage.input_tokens), outputTokens: count(usage.output_tokens) };
}

function callsOf(reply: Record<string, unknown>): number {
  const calls = reply["model_calls"];
  return typeof calls === "number" && Number.isInteger(calls) && calls >= 0 ? calls : 0;
}

function reasonOf(reply: Record<string, unknown>): FallbackReason {
  const reason = reply["reason"];
  return reason === "timeout" || reason === "rejected" || reason === "error" ? reason : "error";
}

/**
 * The reply checked again on this side, whatever the judge already checked:
 * a question of at most forty-five words and 320 characters ending in a
 * question mark, no delimiter echoed back, the kind and the level the server
 * asked for, and a targets note of at most 160 characters. Null refuses it.
 */
export function acceptFollowUp(
  reply: Record<string, unknown>, ask: { kind: RoundKind; depth: number },
): { text: string; targets: string } | null {
  if (reply["status"] !== "ok") return null;
  const text = typeof reply["text"] === "string" ? reply["text"].trim() : "";
  if (!text || text.length > FOLLOW_UP_MAX_CHARS || !text.endsWith("?")) return null;
  if (text.split(/\s+/).length > FOLLOW_UP_MAX_WORDS || text.includes("[[") || text.includes("]]")) {
    return null;
  }
  if (reply["kind"] !== ask.kind) return null;
  const depth = reply["depth"];
  if (typeof depth !== "number" || !Number.isInteger(depth) || depth !== ask.depth) return null;
  const targets = reply["targets"];
  if (typeof targets !== "string" || targets.length > TARGETS_MAX_CHARS) return null;
  return { text, targets };
}

/**
 * Ask the judge for a round's words, and wait at most `deadlineMs`.
 *
 * In time and accepted, the words are the round's. Late, failed or refused,
 * the caller falls back, with the reason the judge gave when it gave one. A
 * late call is not abandoned: `late` resolves when it lands, up to
 * LATE_REPLY_CEILING_MS, so the turn row can record what the model would have
 * cost, and nothing it says is ever used.
 */
export async function askForFollowUp(
  event: Record<string, unknown>,
  ask: { kind: RoundKind; depth: number },
  judge: JudgeCall,
  deadlineMs: number = FOLLOW_UP_DEADLINE_MS,
): Promise<Generation> {
  const controller = new AbortController();
  const ceiling = setTimeout(() => controller.abort(), LATE_REPLY_CEILING_MS);
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);

  type Landed = { reply: Record<string, unknown>; ms: number } | { failed: true; ms: number };
  const call: Promise<Landed> = judge(event, controller.signal).then(
    (reply) => ({ reply, ms: elapsed() }),
    () => ({ failed: true as const, ms: elapsed() }));
  void call.finally(() => clearTimeout(ceiling));

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<"late">((resolve) => { timer = setTimeout(() => resolve("late"), deadlineMs); });
  const first = await Promise.race([call, deadline]);
  clearTimeout(timer);

  if (first === "late") {
    const late = call.then((landed): LateReply | null => "failed" in landed ? null : {
      elapsedMs: landed.ms, modelCalls: callsOf(landed.reply), usage: usageOf(landed.reply),
    });
    return { source: "fallback", reason: "timeout", generationMs: null, modelCalls: 0, usage: NO_USAGE, late };
  }
  if ("failed" in first) {
    return { source: "fallback", reason: "error", generationMs: first.ms, modelCalls: 0, usage: NO_USAGE,
             late: null };
  }

  const reply = first.reply;
  const reported = reply["generation_ms"];
  const generationMs = typeof reported === "number" && Number.isFinite(reported)
    ? Math.round(reported) : first.ms;
  const common = { generationMs, modelCalls: callsOf(reply), usage: usageOf(reply) };
  if (reply["status"] !== "ok") {
    return { source: "fallback", reason: reasonOf(reply), ...common, late: null };
  }
  const accepted = acceptFollowUp(reply, ask);
  if (!accepted) return { source: "fallback", reason: "rejected", ...common, late: null };
  return { source: "generated", text: accepted.text, targets: accepted.targets, ...common };
}

export type FallbackLine =
  | { source: "authored"; followUpId: number; text: string }
  | { source: "probe"; text: string };

/**
 * The line a round asks when the model does not: the question's next unused
 * authored follow-up in its own order, written as an interruption and asked
 * here as a follow-up, then the round's interviewer's next unused probe, each
 * used once per session. Null when both are spent, which the validator makes
 * impossible inside five rounds: every question has two follow-ups and every
 * interviewer two or three probes, and a panel's rounds use its members'.
 */
export function fallbackFor(input: {
  authored: ReadonlyArray<{ id: number; text: string }>;
  usedAuthored: ReadonlySet<number>;
  probes: readonly string[];
  usedProbes: ReadonlySet<string>;
}): FallbackLine | null {
  const followUp = input.authored.find((candidate) => !input.usedAuthored.has(candidate.id));
  if (followUp) return { source: "authored", followUpId: followUp.id, text: followUp.text };
  const probe = input.probes.find((candidate) => !input.usedProbes.has(candidate));
  return probe ? { source: "probe", text: probe } : null;
}
