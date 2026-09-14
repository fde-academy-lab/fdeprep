/**
 * The policy engine.
 *
 * One question, one answer: given an enrolment and a problem, what does this
 * learner see and what may they do right now. Every component asks this and
 * renders what comes back. Nothing else in the product reads `difficulty`,
 * which eslint-rules/no-direct-difficulty.js enforces.
 *
 * Sources: docs/00 sections 3.2 and 4, docs/02 sections 4 and 6.
 */
import type { Pool, PoolClient } from "pg";
import { db } from "../db/pool.ts";
import { allowanceFor, humanise, type Allowance } from "./caps.ts";
import { LAYERS, tierFor, type Difficulty, type Layer, type Visibility } from "./tiers.ts";

export * from "./tiers.ts";
export { RateLimitError, consume, refund, allowanceFor, humanise } from "./caps.ts";
export type { Allowance, Scope } from "./caps.ts";

/** Why a gated action is refused, in words the learner can act on. */
export interface Gate {
  allowed: boolean;
  /** Null when allowed. Otherwise the condition, phrased as the next action. */
  reason: string | null;
  /** The label a button carries, which states its own unlock condition. */
  label: string;
}

export interface Decision {
  difficulty: Difficulty;
  /** Which scaffold layers render. L5 is conditional on pass or give-up. */
  layers: Record<Layer, boolean>;
  visibility: Visibility;
  hints: Gate & { total: number; revealed: number; nextOrdinal: number | null };
  submit: Gate & { remaining: number; max: number | null; resetInS: number | null };
  run: Gate & { remaining: number; max: number | null; resetInS: number | null };
  live: Gate & { remaining: number; max: number | null; resetInS: number | null };
  giveUp: Gate;
  /** Extreme only: Submit stays closed until a learner test with an assertion exists. */
  learnerTests: { required: boolean; present: boolean; withAssertion: boolean };
  defence: { required: boolean; open: boolean; submitted: boolean; reason: string | null };
  attemptNote: { required: boolean; chars: number; needed: number };
  timed: boolean;
  confirmBeforeSubmit: boolean;
  state: { solved: boolean; gaveUp: boolean; failedRuns: number; hintsUsed: number };
}

interface AttemptState {
  difficulty: Difficulty;
  problemId: number;
  attemptId: number | null;
  solved: boolean;
  gaveUp: boolean;
  failedRuns: number;
  hintsUsed: number;
  hintTotal: number;
  attemptNoteChars: number;
  learnerTestBodies: string[];
  artefactType: ArtefactType;
  defenceSubmitted: boolean;
  hasDefenceQuestion: boolean;
}

export type ArtefactType = "code" | "prompt" | "design";

export async function resolvePolicy(options: {
  enrolmentId: number;
  problemId: number;
  client?: Pool | PoolClient;
}): Promise<Decision> {
  const client = options.client ?? db();
  const state = await loadState(client, options.enrolmentId, options.problemId);
  const tier = tierFor(state.difficulty);

  // Sequential on purpose. When a PoolClient is passed in, this runs inside
  // someone's transaction, and a single client cannot serve concurrent
  // queries. Promise.all here trips pg's already-executing warning and the
  // results are not safe to rely on.
  const run = await allowanceFor({
    ...options, difficulty: state.difficulty, scope: "run_hourly", client });
  const submit = await allowanceFor({
    ...options, difficulty: state.difficulty, scope: "submit_daily", client });
  const live = await allowanceFor({
    ...options, difficulty: state.difficulty, scope: "live_daily", client });

  const hints = resolveHints(tier.hints, state);
  // The Extreme learner-test gate asks for a test before a submit, which only
  // means anything when there is code to test. A prompt or design answer has
  // no test surface, so the gate is a tier rule scoped to code artefacts
  // rather than a tier rule the other two artefacts fail on forever.
  const learnerTests = resolveLearnerTests(
    tier.requiresLearnerTests && state.artefactType === "code", state.learnerTestBodies);
  const attemptNote = resolveAttemptNote(tier.hints, state.attemptNoteChars);

  const layers: Record<Layer, boolean> = Object.fromEntries(
    LAYERS.map((layer) => [layer, tier.layers.includes(layer)]),
  ) as Record<Layer, boolean>;
  // L5 is not a tier property. It unlocks on a pass or an explicit give-up.
  layers.reference = state.solved || state.gaveUp;
  // The hints layer renders only where the tier has hints at all.
  layers.hints = tier.hints.kind !== "never";

  return {
    difficulty: state.difficulty,
    layers,
    visibility: tier.visibility,
    hints,
    run: { ...gateFromAllowance(run, "Run"), ...span(run) },
    submit: { ...resolveSubmit(submit, learnerTests), ...span(submit) },
    live: { ...gateFromAllowance(live, "Live run"), ...span(live) },
    giveUp: resolveGiveUp(state),
    learnerTests,
    defence: resolveDefence(tier.requiresDefence, state),
    attemptNote,
    timed: tier.timed,
    confirmBeforeSubmit: tier.confirmBeforeSubmit,
    state: {
      solved: state.solved, gaveUp: state.gaveUp,
      failedRuns: state.failedRuns, hintsUsed: state.hintsUsed,
    },
  };
}

function span(allowance: Allowance) {
  return {
    remaining: allowance.max === null ? Number.POSITIVE_INFINITY : allowance.remaining,
    max: allowance.max,
    resetInS: allowance.resetInS,
  };
}

function resolveHints(rule: ReturnType<typeof tierFor>["hints"], state: AttemptState) {
  const nextOrdinal = state.hintsUsed < state.hintTotal ? state.hintsUsed + 1 : null;
  const base = { total: state.hintTotal, revealed: state.hintsUsed, nextOrdinal };

  if (rule.kind === "never") {
    return { ...base, allowed: false, reason: "Extreme carries no hints at any point.",
             label: "No hints on Extreme" };
  }
  if (nextOrdinal === null) {
    return { ...base, allowed: false,
             reason: state.hintTotal === 0
               ? "This problem has no hints."
               : "You have revealed every hint on this problem.",
             label: state.hintTotal === 0 ? "No hints" : "All hints revealed" };
  }
  if (rule.kind === "free") {
    return { ...base, allowed: true, reason: null, label: `Reveal hint ${nextOrdinal}` };
  }

  if (state.failedRuns < rule.failedRuns) {
    const needed = rule.failedRuns - state.failedRuns;
    const runs = rule.failedRuns === 1 ? "one failed run" : `${rule.failedRuns} failed runs`;
    return { ...base, allowed: false,
             reason: `Hints unlock after ${runs}. ${needed} to go.`,
             label: `Unlocks after ${runs}` };
  }
  if (rule.kind === "after_failed_runs_and_note" && state.attemptNoteChars < rule.noteChars) {
    const short = rule.noteChars - state.attemptNoteChars;
    return { ...base, allowed: false,
             reason: `Write an attempt note of at least ${rule.noteChars} characters first. ` +
                     `${short} more to go.`,
             label: `Unlocks after a ${rule.noteChars} character note` };
  }
  return { ...base, allowed: true, reason: null, label: `Reveal hint ${nextOrdinal}` };
}

function resolveLearnerTests(required: boolean, bodies: string[]) {
  const withAssertion = bodies.some(hasAssertion);
  return { required, present: bodies.length > 0, withAssertion };
}

/** A learner test counts only when it actually asserts something. */
export function hasAssertion(body: string): boolean {
  return /\bassert\b|\bself\.assert\w+\s*\(|\bpytest\.raises\b/.test(body);
}

function resolveAttemptNote(rule: ReturnType<typeof tierFor>["hints"], chars: number) {
  if (rule.kind !== "after_failed_runs_and_note") {
    return { required: false, chars, needed: 0 };
  }
  return { required: true, chars, needed: Math.max(0, rule.noteChars - chars) };
}

function gateFromAllowance(allowance: Allowance, action: string): Gate {
  if (allowance.max === null || allowance.remaining > 0) {
    const suffix = allowance.max === null ? "" : ` (${allowance.remaining})`;
    return { allowed: true, reason: null, label: `${action}${suffix}` };
  }
  return { allowed: false, reason: exhaustedReason(allowance), label: `${action} unavailable` };
}

function resolveSubmit(
  allowance: Allowance, learnerTests: { required: boolean; withAssertion: boolean },
): Gate {
  // The learner-test gate is checked first, because telling someone their cap
  // is spent when the real blocker is a missing test sends them away for a day.
  if (learnerTests.required && !learnerTests.withAssertion) {
    return {
      allowed: false,
      reason: "Write at least one test containing an assertion before you submit. " +
              "On Extreme the tests come first.",
      label: "Write a test first",
    };
  }
  return gateFromAllowance(allowance, "Submit");
}

function resolveGiveUp(state: AttemptState): Gate {
  if (state.solved) {
    return { allowed: false, reason: "You have already passed this problem.",
             label: "Solved" };
  }
  if (state.gaveUp) {
    return { allowed: false, reason: "You have already given up on this problem.",
             label: "Walkthrough unlocked" };
  }
  return {
    allowed: true, reason: null,
    label: "Give up and show the walkthrough",
  };
}

function exhaustedReason(allowance: Allowance): string {
  const when = humanise(allowance.resetInS ?? allowance.windowS);
  if (allowance.scope === "submit_daily" && allowance.max === 1) {
    return `Extreme allows one submit per problem per day. Your next attempt is in ${when}.`;
  }
  return `You have used all ${allowance.max} of these today. More in ${when}.`;
}

/**
 * docs/03 section 4.4: the defence runs on Hard and Extreme code problems
 * after a pass. It asks the learner to say why their solution works, which
 * needs a solution, so it opens on a pass and not before.
 */
function resolveDefence(
  required: boolean, state: AttemptState,
): { required: boolean; open: boolean; submitted: boolean; reason: string | null } {
  // The question is authored with the problem. Without one the step does not
  // exist, and the validator rejects a Hard or Extreme code problem that
  // omits it, so this branch only fires on a problem written before the rule.
  const applies = required && state.artefactType === "code" && state.hasDefenceQuestion;
  if (!applies) {
    return { required: false, open: false, submitted: state.defenceSubmitted, reason: null };
  }
  if (!state.solved) {
    return { required: true, open: false, submitted: false,
             reason: "The defence opens once the battery passes." };
  }
  if (state.defenceSubmitted) {
    return { required: true, open: false, submitted: true,
             reason: "Your defence is recorded. The attempt is complete." };
  }
  return { required: true, open: true, submitted: false, reason: null };
}

async function loadState(
  client: Pool | PoolClient, enrolmentId: number, problemId: number,
): Promise<AttemptState> {
  const { rows } = await client.query<{
    difficulty: Difficulty; attempt_id: string | null; solved: boolean; gave_up: boolean;
    failed_runs: number; hints_used: number; hint_total: number; note_chars: number;
    artefact_type: ArtefactType; defence_submitted: boolean; has_defence_question: boolean;
  }>(
    `select p.difficulty::text as difficulty,
            p.artefact_type::text as artefact_type,
            a.id as attempt_id,
            a.solved_at is not null as solved,
            a.gave_up_at is not null as gave_up,
            coalesce((select count(*) from submission s
                       where s.attempt_id = a.id
                         and s.verdict is not null and s.verdict <> 'pass'), 0)::int as failed_runs,
            coalesce(a.hints_used, 0)::int as hints_used,
            (select count(*) from hint h
               join problem_version v on v.id = h.problem_version_id
              where v.problem_id = p.id and v.version = p.current_version)::int as hint_total,
            coalesce(length(a.attempt_note), 0)::int as note_chars,
            a.defence_score is not null as defence_submitted,
            (select v.defence_question is not null from problem_version v
              where v.problem_id = p.id and v.version = p.current_version) as has_defence_question
       from problem p
       left join attempt a on a.problem_id = p.id and a.enrolment_id = $2
      where p.id = $1`,
    [problemId, enrolmentId]);

  const row = rows[0];
  if (!row) throw new Error(`problem ${problemId} not found`);

  const bodies = row.attempt_id
    ? (await client.query<{ body: string }>(
        "select body from learner_test where attempt_id = $1", [row.attempt_id])).rows
        .map((r) => r.body)
    : [];

  return {
    difficulty: row.difficulty,
    artefactType: row.artefact_type,
    defenceSubmitted: row.defence_submitted,
    hasDefenceQuestion: row.has_defence_question === true,
    problemId,
    attemptId: row.attempt_id ? Number(row.attempt_id) : null,
    solved: row.solved,
    gaveUp: row.gave_up,
    failedRuns: row.failed_runs,
    hintsUsed: row.hints_used,
    hintTotal: row.hint_total,
    attemptNoteChars: row.note_chars,
    learnerTestBodies: bodies,
  };
}
