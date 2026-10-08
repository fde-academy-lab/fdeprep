/**
 * The seed plan: who sits down on which day, what they try, and how it goes.
 *
 * Pure. No database and no clock: the day the seed runs and the published
 * catalogue come in as data, and a seeded random source does the rest, so the
 * same inputs plan the same rows. web/lib/seed/run.ts carries the plan out
 * through the production write paths. Nothing here writes anything, and in
 * particular nothing here decides a grade: an outcome names the result
 * contract the runner or the judge would have produced, and eval/ grades it.
 *
 * Every tier rule comes from the policy module, as CLAUDE.md requires.
 */
import type { Band } from "../policy/bands.ts";
import type { Persona } from "../policy/roadmap.ts";
import { tierFor, type Difficulty } from "../policy/tiers.ts";
import {
  COHORTS, PEOPLE, practises, type Archetype, type CohortKey, type Person, type Role,
} from "./names.ts";
import { Random } from "./random.ts";

/* ------------------------------------------------------------ catalogue in */

export interface CatalogueProblem {
  slug: string;
  difficulty: Difficulty;
  artefactType: "code" | "prompt" | "design";
  hints: number;
  callBudget: number | null;
  /** submit_daily for this problem, null where no cap applies. */
  submitCap: number | null;
  hasDefence: boolean;
  build: { id: string; stage: number } | null;
}

export interface CatalogueQuestion {
  slug: string;
  totalSeconds: number;
  beats: number;
  /** Bands with an authored exemplar, which is what a transcript is built from. */
  bands: readonly Band[];
  followUps: number;
}

export interface Catalogue {
  problems: readonly CatalogueProblem[];
  /** Every problem on each persona's track, in track order. */
  paths: Readonly<Record<Persona, readonly string[]>>;
  questions: readonly CatalogueQuestion[];
}

/* ------------------------------------------------------------- plan out */

/** The result a submit is scripted to come back with. */
export type Outcome = "clean" | "hinted" | "over_budget" | "fail" | "error" | "timeout";

export interface AttemptAction {
  type: "attempt";
  slug: string;
  /** Failing runs before the submit. */
  runs: number;
  /** Hints revealed after the runs and before the submit. */
  hints: number;
  /** Save a learner test first, because the tier will not open Submit without one. */
  learnerTest: boolean;
  outcome: Outcome;
  /** The rubric band, on design problems. */
  band?: Band;
  /** A defence after the pass, scored by the judge out of a hundred. */
  defence?: number;
  /** Submit again the same day; the cap refuses it. Planned exactly once. */
  refusedRetry?: true;
}

export interface RehearsalAction {
  type: "rehearsal";
  /** What startRehearsal is expected to draw. The runner checks. */
  drawn: string[];
  submits: Array<{ slug: string; outcome: "clean" | "fail"; band?: Band }>;
  finished: boolean;
}

export interface VoiceAction {
  type: "voice";
  question: string;
  mode: "guided" | "unguided" | "pressure";
  input: "spoken" | "typed";
  band: Band;
  /** Beats the judge says were covered, counted from the first. */
  covered: number;
  /** Out of fifty, what the scripted judge awards for content. */
  contentPoints: number;
  durationS: number;
  /** Stopped inside thirty seconds and forty words, so it does not count. */
  short: boolean;
  /** Seeds the sentence order of the transcript. */
  order: number;
}

export interface InviteAction {
  type: "invite";
  key: string;
  cohort: CohortKey;
  role: Role;
  persona: Persona;
  githubLogin: string | null;
  note: string;
  days: number;
}

export type Action =
  | AttemptAction
  | RehearsalAction
  | VoiceAction
  | { type: "consent" }
  | InviteAction
  | { type: "withdraw"; invite: string }
  | { type: "redeem"; invite: string }
  | { type: "persona_csv"; cohort: CohortKey; rows: Array<{ login: string; persona: Persona }> }
  | { type: "degraded"; reason: string };

export interface Sitting {
  login: string;
  daysAgo: number;
  /** Minutes after midnight UTC. */
  minute: number;
  actions: Action[];
}

export interface PlannedDisagreement {
  login: string;
  slug: string;
  /** What panelist 2 and panelist 3 say. Two steps apart, so consolidate() disagrees. */
  bands: { pretrained: Band; llm: Band };
  review: { daysAgo: number; disposition: "upheld" | "disputed"; note: string } | null;
  override: { band: Band; note: string } | null;
}

export interface StuckSubmission {
  login: string;
  slug: string;
  minutesAgo: number;
  learnerTest: boolean;
}

export interface StuckVoice {
  login: string;
  question: string;
  minutesAgo: number;
  /** never: the scorer is not running. gives_up: three judge failures, allowance given back. */
  judge: "never" | "gives_up";
}

export interface Expected {
  people: number;
  submissions: number;
  voiceSessions: number;
  rehearsals: number;
  unfinishedRehearsals: number;
  consents: number;
  invites: { pending: number; used: number; withdrawn: number; expired: number };
  personaChanges: number;
  disagreements: { open: number; upheld: number; overridden: number };
  stuck: { submissions: number; voiceNotScored: number; voiceGaveUp: number };
  refusedRetries: number;
}

export interface SeedPlan {
  today: string;
  scale: "full" | "test";
  people: Person[];
  /** Oldest first, then by time of day. */
  sittings: Sitting[];
  disagreements: PlannedDisagreement[];
  stuck: { submissions: StuckSubmission[]; voice: StuckVoice[] };
  /** Given back by an admin for the oldest stuck submission. */
  counterClear: { login: string; slug: string; minutesAgo: number; reason: string };
  admin: string;
  faculty: string;
  expected: Expected;
}

export interface PlanOptions {
  /** The day the seed runs, YYYY-MM-DD. Every day in the plan counts back from it. */
  today: string;
  catalogue: Catalogue;
  /** full: forty people over ninety days. test: six learners over fourteen days. */
  scale?: "full" | "test";
  seed?: number;
}

/* ------------------------------------------------------------- the knobs */

export const DEFAULT_SEED = 20261008;

/**
 * The test plan's seed, chosen because its fourteen days show every path:
 * all six outcomes, a refused retry, a stalled learner with three failed
 * submits, three disagreements and every voice mode. tests/seed.test.ts fails
 * when a change to this file or to the fixtures loses one of them.
 */
export const TEST_SEED = 298;

/**
 * How each archetype's submits come out. Tuned by eye against the brief:
 * steady is mixed, a sprinter mostly passes clean, and stalled leans on hints.
 */
const OUTCOMES: Readonly<Record<Exclude<Archetype, "new">, Record<Outcome, number>>> = {
  steady:   { clean: 40, hinted: 18, over_budget: 8, fail: 26, error: 4, timeout: 4 },
  sprinter: { clean: 72, hinted: 6,  over_budget: 6, fail: 10, error: 4, timeout: 2 },
  stalled:  { clean: 35, hinted: 25, over_budget: 5, fail: 27, error: 4, timeout: 4 },
  lapsed:   { clean: 36, hinted: 20, over_budget: 8, fail: 28, error: 4, timeout: 4 },
};

/** Chance of a sitting on a weekday. Sets the volume: the full plan lands near 1,100 submissions. */
const WEEKDAY_ODDS: Readonly<Record<"steady" | "stalled" | "lapsed", number>> = {
  steady: 0.18, stalled: 0.25, lapsed: 0.28,
};

/** Problems per sitting, inclusive. */
const PER_SITTING: Readonly<Record<Exclude<Archetype, "new">, [number, number]>> = {
  steady: [1, 2], sprinter: [2, 3], stalled: [1, 1], lapsed: [1, 2],
};

const VOICE_ODDS: Readonly<Record<Exclude<Archetype, "new">, number>> = {
  steady: 0.65, sprinter: 0.4, stalled: 0.45, lapsed: 0.5,
};

const VOICE_BANDS: Readonly<Record<Exclude<Archetype, "new">, Record<"strong" | "adequate" | "weak", number>>> = {
  steady:   { strong: 30, adequate: 50, weak: 20 },
  sprinter: { strong: 55, adequate: 35, weak: 10 },
  stalled:  { strong: 15, adequate: 45, weak: 40 },
  lapsed:   { strong: 25, adequate: 50, weak: 25 },
};

/**
 * How much denser the test plan's fourteen days are than the full plan's
 * ninety. The test plan has to show every path the seed takes, a refused
 * retry and a disagreement among them, with six learners.
 */
const TEST_DENSITY = 3;

/** A failed problem is tried this many times before a learner moves on. Stalled never moves on. */
const RETRIES_BEFORE_MOVING_ON = 2;

const NOTES = {
  override: "Read against the rubric, this answer meets each criterion, so it holds the strong band.",
  upheld: "The lower band is right. The answer restates the brief and commits to nothing a " +
          "reviewer could check.",
  disputed: "The band is wrong. The answer meets every criterion in the rubric and should be strong.",
  counterClear: "The submission from two days ago never got a result. Giving the attempt back.",
  degraded: "Runner rollback in progress.",
};

/* ------------------------------------------------------------- the plan */

interface Pending { fails: number; lastDay: number }

interface LearnerState {
  person: Person;
  persona: Persona;
  solved: Set<string>;
  pending: Map<string, Pending>;
  abandoned: Set<string>;
  /** Every problem with a submission against it, rehearsals included. */
  touched: Set<string>;
  testWritten: Set<string>;
  stuckOn: string | null;
  stallAfter: number;
  sittings: number;
}

export function plan(options: PlanOptions): SeedPlan {
  const scale = options.scale ?? "full";
  const random = new Random(options.seed ?? (scale === "test" ? TEST_SEED : DEFAULT_SEED));
  const { catalogue, today } = options;
  const window = scale === "test" ? 14 : 90;
  const problems = new Map(catalogue.problems.map((p) => [p.slug, p]));
  if (!catalogue.questions.length) throw new Error("the plan needs at least one voice question");

  const people = PEOPLE.filter((p) => scale === "full" || p.inTestPlan ||
    (p.cohort === "c3" && p.role !== "learner"));
  const admin = people.find((p) => p.role === "admin")!;
  const faculty = people.find((p) => p.role === "faculty")!;

  const sittings: Sitting[] = [];
  const designPasses: Array<{ login: string; slug: string; daysAgo: number; minute: number }> = [];
  const voice: Array<{ person: Person; action: VoiceAction; daysAgo: number }> = [];
  const states = new Map<string, LearnerState>();
  let refusedRetryPlanned = false;
  let sprinterIndex = 0;
  const questionOrder = random.shuffle(catalogue.questions);
  let questionCursor = 0;

  // When each join by invite happens, and the admin's own sittings.
  const joinDay = new Map<string, number>(scale === "test"
    ? [["ruth-adeyemi", 9], ["mateus-costa", 4]]
    : [["ruth-adeyemi", 15], ["mateus-costa", 6]]);
  const csv = scale === "test"
    ? { daysAgo: 7, rows: [{ login: "adaeze-eze", persona: "navigator" as Persona },
                           { login: "priya-raghavan", persona: "builder" as Persona }] }
    : { daysAgo: 60, rows: [{ login: "opennington", persona: "builder" as Persona },
                            { login: "emeka-nwosu", persona: "accelerator" as Persona },
                            { login: "jmwangi", persona: "navigator" as Persona },
                            { login: "priya-raghavan", persona: "builder" as Persona }] };
  const personaAfter = new Map(csv.rows.map((row) => [row.login, row.persona]));

  const nextQuestion = () => questionOrder[questionCursor++ % questionOrder.length]!;

  for (const person of people) {
    const cohort = COHORTS.find((c) => c.key === person.cohort)!;
    const from = joinDay.get(person.login) ?? Math.min(window - 1, cohort.startsDaysAgo);
    const preferred = random.int(150, 900);
    const minute = () => preferred + random.int(-40, 40);

    if (person.voiceOnly) {
      for (const daysAgo of [from - 1, from - 4, from - 7].filter((d) => d >= 0)) {
        const action = voiceAction(person, nextQuestion(), random, "typed");
        voice.push({ person, action, daysAgo });
        sittings.push({ login: person.login, daysAgo, minute: minute(), actions: [action] });
      }
      continue;
    }
    if (!practises(person)) continue;

    const archetype = person.archetype as Exclude<Archetype, "new">;
    const state: LearnerState = {
      person, persona: person.persona, solved: new Set(), pending: new Map(),
      abandoned: new Set(), touched: new Set(), testWritten: new Set(), stuckOn: null,
      stallAfter: scale === "test" ? random.int(2, 3) : random.int(1, 3), sittings: 0,
    };
    states.set(person.login, state);
    const isSprinter = archetype === "sprinter";
    const thisSprinter = isSprinter ? sprinterIndex++ : -1;

    const days = activeDays(person, from, scale, today, random);
    // A sprinter's two rehearsals: the first sitting and the fourth, or the
    // last when a burst is shorter. Two in a week is the weekly cap, exactly.
    const rehearsals = new Set(isSprinter ? [0, Math.min(3, days.length - 1)] : []);
    for (const daysAgo of days) {
      if (personaAfter.has(person.login) && daysAgo <= csv.daysAgo) {
        state.persona = personaAfter.get(person.login)!;
      }
      const actions: Action[] = [];
      const at = minute();
      if (state.sittings === 0) actions.push({ type: "consent" });
      const used = new Set<string>();

      if (rehearsals.has(state.sittings)) {
        const second = state.sittings > 0;
        // Two sittings are left unfinished across the plan: the second
        // rehearsal of the first two sprinters.
        const finished = !(second && thisSprinter < 2);
        const rehearsal = rehearsalAction(state, catalogue, problems, finished, random);
        actions.push(rehearsal);
        for (const submit of rehearsal.submits) used.add(submit.slug);
      }

      const [low, high] = PER_SITTING[archetype];
      let count = random.int(low, high);
      if (archetype === "stalled" && state.stuckOn && random.chance(0.3)) count += 1;
      for (let i = 0; i < count; i += 1) {
        const slug = nextSlug(state, catalogue, problems, daysAgo, used);
        if (!slug) break;
        used.add(slug);
        const problem = problems.get(slug)!;
        // The one planned refusal: the first sprinter to reach a problem that
        // allows one submit a day fails it and tries again the same day.
        const refuse = !refusedRetryPlanned && isSprinter && problem.submitCap === 1 &&
          problem.artefactType === "code";
        const action = attemptAction(state, problem, archetype, random, refuse);
        if (refuse) {
          action.refusedRetry = true;
          refusedRetryPlanned = true;
        }
        actions.push(action);
        record(state, action, daysAgo, archetype);
        if (problem.artefactType === "design" && passes(action.outcome)) {
          designPasses.push({ login: person.login, slug, daysAgo, minute: at });
        }
      }

      if (random.chance(VOICE_ODDS[archetype])) {
        const action = voiceAction(person, nextQuestion(), random,
                                   random.chance(0.3) ? "typed" : "spoken");
        voice.push({ person, action, daysAgo });
        actions.push(action);
      }

      state.sittings += 1;
      sittings.push({ login: person.login, daysAgo, minute: at, actions });
    }
  }

  markShortAndPressure(voice, scale, catalogue);
  sittings.push(...adminSittings(admin, people, joinDay, csv, window, scale));

  sittings.sort((a, b) => b.daysAgo - a.daysAgo || a.minute - b.minute ||
                          a.login.localeCompare(b.login));

  const disagreements = allocateDisagreements(designPasses);
  const stuck = stuckRows(people, states, catalogue, problems, voice);
  const oldest = stuck.submissions[stuck.submissions.length - 1]!;

  return {
    today,
    scale,
    people,
    sittings,
    disagreements,
    stuck,
    counterClear: {
      login: oldest.login, slug: oldest.slug, minutesAgo: oldest.minutesAgo - 60,
      reason: NOTES.counterClear,
    },
    admin: admin.login,
    faculty: faculty.login,
    expected: expectedFrom(people, sittings, disagreements, stuck, csv.rows, refusedRetryPlanned),
  };
}

/* ------------------------------------------------------------ the days */

function weekday(today: string, daysAgo: number): number {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.getUTCDay();
}

/** The days a learner sits down, oldest first, as days before today. */
function activeDays(
  person: Person, from: number, scale: "full" | "test", today: string, random: Random,
): number[] {
  const days: number[] = [];
  const working = (daysAgo: number) => {
    const day = weekday(today, daysAgo);
    return day >= 1 && day <= 5;
  };

  if (person.archetype === "sprinter") {
    let start = from - random.int(0, 3);
    while (start >= 0) {
      const length = scale === "test" ? random.int(4, 5) : random.int(3, 4);
      for (let d = start; d > start - length && d >= 0; d -= 1) days.push(d);
      start -= random.int(18, 26);
    }
    return days;
  }

  // Lapsed: worked early and stopped. In Cohort 3 the last sitting is over a
  // month ago. Cohort 4 is three weeks old, so its lapsed learners stop after
  // the first week and the test plan's after its first four days.
  const lastDay = person.archetype === "lapsed"
    ? (scale === "test" ? 10 : person.cohort === "c3" ? 36 : 15)
    : 0;
  const density = scale === "test" ? TEST_DENSITY : 1;
  const odds = WEEKDAY_ODDS[person.archetype as "steady" | "stalled" | "lapsed"] * density;
  for (let d = from; d >= lastDay; d -= 1) {
    if (random.chance(working(d) ? odds : odds / 6)) days.push(d);
  }
  if (!days.length) days.push(from);
  return days;
}

/* --------------------------------------------------------- the problems */

function passes(outcome: Outcome): boolean {
  return outcome === "clean" || outcome === "hinted" || outcome === "over_budget";
}

/**
 * The next problem: a failure waiting for another try first, then the first
 * thing on the path the learner has not started, skipping a build stage whose
 * previous stage is not passed, because createSubmission refuses those.
 */
function nextSlug(
  state: LearnerState, catalogue: Catalogue, problems: Map<string, CatalogueProblem>,
  daysAgo: number, used: Set<string>,
): string | null {
  if (state.stuckOn && !used.has(state.stuckOn) && spaced(state, problems, state.stuckOn, daysAgo)) {
    return state.stuckOn;
  }
  for (const [slug] of state.pending) {
    if (slug === state.stuckOn || used.has(slug)) continue;
    if (spaced(state, problems, slug, daysAgo)) return slug;
  }
  for (const slug of catalogue.paths[state.persona]) {
    if (state.solved.has(slug) || state.pending.has(slug) || state.abandoned.has(slug) ||
        used.has(slug)) continue;
    if (locked(state, catalogue, problems.get(slug)!)) continue;
    return slug;
  }
  return null;
}

/**
 * Caps are rolling windows. A problem allowing one submit a day takes its next
 * one two days on, so a sitting late yesterday never shares a window with one
 * early today.
 */
function spaced(
  state: LearnerState, problems: Map<string, CatalogueProblem>, slug: string, daysAgo: number,
): boolean {
  const pending = state.pending.get(slug);
  if (!pending || problems.get(slug)!.submitCap !== 1) return true;
  return pending.lastDay - daysAgo >= 2;
}

function locked(state: LearnerState, catalogue: Catalogue, problem: CatalogueProblem): boolean {
  if (!problem.build || problem.build.stage <= 1) return false;
  const previous = catalogue.problems.find((p) =>
    p.build?.id === problem.build!.id && p.build.stage === problem.build!.stage - 1);
  return previous ? !state.solved.has(previous.slug) : false;
}

function attemptAction(
  state: LearnerState, problem: CatalogueProblem, archetype: Exclude<Archetype, "new">,
  random: Random, forceFail: boolean,
): AttemptAction {
  const tier = tierFor(problem.difficulty);
  const code = problem.artefactType === "code";
  // A stalled learner sticks on a code problem: failed runs and failed submits
  // against the same tests are what the stuck list in docs/00 section 8 reads.
  if (archetype === "stalled" && !state.stuckOn && state.solved.size >= state.stallAfter &&
      code && !state.pending.has(problem.slug)) {
    state.stuckOn = problem.slug;
  }

  let outcome = random.weighted(OUTCOMES[archetype]);
  if (problem.slug === state.stuckOn || forceFail) outcome = "fail";
  outcome = admissible(outcome, problem);

  const hintRuns = tier.hints.kind === "after_failed_runs" ? tier.hints.failedRuns : 0;
  const runs = code ? Math.max(random.chance(0.35) ? 2 : 1, outcome === "hinted" ? hintRuns : 0) : 0;
  const hints = outcome === "hinted" ? random.int(1, Math.min(2, problem.hints)) : 0;
  const learnerTest = code && tier.requiresLearnerTests && !state.testWritten.has(problem.slug);
  const action: AttemptAction = { type: "attempt", slug: problem.slug, runs, hints, learnerTest, outcome };

  if (problem.artefactType === "design") {
    action.band = passes(outcome) ? (random.chance(0.6) ? "strong" : "adequate") : "weak";
  }
  if (code && passes(outcome) && tier.requiresDefence && problem.hasDefence) {
    action.defence = random.int(70, 92);
  }
  return action;
}

/**
 * Turn a drawn outcome into one this problem can produce.
 *
 * A judged problem has no runs, no budget and no timeout, and this plan gives
 * it no hints. A pass over budget is planned only where no defence follows:
 * the defence comes back with no call count, competency/score.ts reads a
 * missing count as within budget, and the over-budget pass would turn clean.
 * Hints are planned only where the tier opens them on failed runs alone.
 */
function admissible(outcome: Outcome, problem: CatalogueProblem): Outcome {
  const tier = tierFor(problem.difficulty);
  if (problem.artefactType !== "code") {
    if (outcome === "hinted" || outcome === "over_budget") return "clean";
    if (outcome === "timeout") return "error";
    return outcome;
  }
  if (outcome === "over_budget" && (problem.callBudget === null || tier.requiresDefence)) {
    return "clean";
  }
  if (outcome === "hinted" && (problem.hints === 0 ||
      (tier.hints.kind !== "free" && tier.hints.kind !== "after_failed_runs"))) {
    return "clean";
  }
  return outcome;
}

function record(
  state: LearnerState, action: AttemptAction, daysAgo: number,
  archetype: Exclude<Archetype, "new">,
): void {
  state.touched.add(action.slug);
  if (action.learnerTest) state.testWritten.add(action.slug);
  const pending = state.pending.get(action.slug) ?? { fails: 0, lastDay: daysAgo };
  if (passes(action.outcome)) {
    state.solved.add(action.slug);
    state.pending.delete(action.slug);
    return;
  }
  pending.lastDay = daysAgo;
  if (action.outcome === "fail") pending.fails += 1;
  if (archetype !== "stalled" && pending.fails >= RETRIES_BEFORE_MOVING_ON) {
    state.pending.delete(action.slug);
    state.abandoned.add(action.slug);
    return;
  }
  state.pending.set(action.slug, pending);
}

/**
 * A rehearsal, drawn the way lib/rehearsal/index.ts draws one: the first three
 * unsolved problems on the roadmap, or the first three of all of it when fewer
 * than three are left.
 */
function rehearsalAction(
  state: LearnerState, catalogue: Catalogue, problems: Map<string, CatalogueProblem>,
  finished: boolean, random: Random,
): RehearsalAction {
  const path = catalogue.paths[state.persona];
  const unsolved = path.filter((slug) => !state.solved.has(slug));
  const drawn = (unsolved.length >= 3 ? unsolved : [...path]).slice(0, 3);
  const count = finished ? random.int(2, 3) : 1;
  const submits = drawn.slice(0, count).map((slug) => {
    const outcome: "clean" | "fail" = random.chance(0.75) ? "clean" : "fail";
    const problem = problems.get(slug)!;
    state.touched.add(slug);
    return problem.artefactType === "design"
      ? { slug, outcome, band: (outcome === "clean" ? "strong" : "weak") as Band }
      : { slug, outcome };
  });
  return { type: "rehearsal", drawn, submits, finished };
}

/* ------------------------------------------------------------ the voice */

function voiceAction(
  person: Person, question: CatalogueQuestion, random: Random, input: "spoken" | "typed",
): VoiceAction {
  const archetype = (person.archetype === "new" ? "steady" : person.archetype) as
    Exclude<Archetype, "new">;
  let band: Band = random.weighted(VOICE_BANDS[archetype]);
  if (!question.bands.includes(band)) band = question.bands[0] ?? "adequate";
  const covered = band === "strong" ? question.beats
    : band === "adequate" ? Math.max(1, question.beats - random.int(1, 2))
    : Math.min(question.beats, random.int(1, 2));
  const contentPoints = band === "strong" ? random.int(40, 46)
    : band === "adequate" ? random.int(27, 34) : random.int(11, 18);
  return {
    type: "voice",
    question: question.slug,
    mode: random.chance(0.6) ? "guided" : "unguided",
    input,
    band,
    covered,
    contentPoints,
    durationS: Math.max(40, Math.round(question.totalSeconds * (0.7 + random.next() * 0.25))),
    short: false,
    order: random.int(1, 1_000_000_000),
  };
}

/**
 * Two answers per practising archetype that stop inside thirty seconds and
 * forty words, so finishSession's did_not_count path runs and gives the unit
 * back, and four answers in pressure mode from steady learners, who never sit
 * a rehearsal and so never meet the weekly cap that pressure shares with it.
 * The test plan takes one of each.
 */
function markShortAndPressure(
  voice: Array<{ person: Person; action: VoiceAction; daysAgo: number }>,
  scale: "full" | "test", catalogue: Catalogue,
): void {
  const perArchetype = scale === "test" ? 1 : 2;
  for (const archetype of ["steady", "sprinter", "stalled", "lapsed"] as const) {
    const candidates = voice.filter((v) => v.person.archetype === archetype &&
      !v.person.voiceOnly);
    for (const entry of candidates.slice(0, perArchetype)) {
      entry.action.short = true;
      entry.action.input = "spoken";
      if (entry.action.mode === "pressure") entry.action.mode = "guided";
    }
  }

  const followUps = new Map(catalogue.questions.map((q) => [q.slug, q.followUps]));
  const pressure = scale === "test" ? 1 : 4;
  const seen = new Set<string>();
  const steady = voice.filter((v) => v.person.archetype === "steady" && !v.action.short &&
    (followUps.get(v.action.question) ?? 0) > 0).reverse();
  for (const entry of steady) {
    if (seen.size >= pressure) break;
    if (seen.has(entry.person.login)) continue;
    seen.add(entry.person.login);
    entry.action.mode = "pressure";
    entry.action.input = "spoken";
  }
}

/* ---------------------------------------------------------- the admin */

function adminSittings(
  admin: Person, people: Person[], joinDay: Map<string, number>,
  csv: { daysAgo: number; rows: Array<{ login: string; persona: Persona }> },
  window: number, scale: "full" | "test",
): Sitting[] {
  const out: Sitting[] = [];
  const at = (daysAgo: number, minute: number, actions: Action[]) =>
    out.push({ login: admin.login, daysAgo, minute, actions });

  const invite = (key: string, cohort: CohortKey, persona: Persona, githubLogin: string | null,
                  note: string, days = 14): InviteAction =>
    ({ type: "invite", key, cohort, role: "learner", persona, githubLogin, note, days });

  at(Math.min(30, window - 1), 70,
     [invite("expired", "c3", "accelerator", "lena-hoffmann", "Tester who never signed in", 7)]);
  at(12, 75, [invite("withdrawn", "c3", "navigator", null, "Made for the wrong cohort")]);
  at(11, 80, [{ type: "withdraw", invite: "withdrawn" }]);
  at(3, 85, [invite("pending-voice", "c3", "navigator", null, "Second tester for the voice screen")]);
  at(1, 90, [invite("pending-seat", "c3", "builder", "kwame-asante",
                    "Replacement for a seat given up in week two")]);

  // Thirty days, so a link made two weeks before the seed runs is still good
  // when it is redeemed: the seed redeems it now, against the real clock.
  for (const person of people.filter((p) => p.joinsByInvite)) {
    const day = joinDay.get(person.login)!;
    at(day + 1, 95, [invite(person.login, person.cohort, person.persona, person.login,
                            "Joining Cohort 4 after it started", 30)]);
    out.push({ login: person.login, daysAgo: day, minute: 600, actions: [
      { type: "redeem", invite: person.login }] });
  }

  at(csv.daysAgo, 60, [{ type: "persona_csv", cohort: "c3", rows: csv.rows }]);
  at(scale === "test" ? 5 : 40, 50, [{ type: "degraded", reason: NOTES.degraded }]);
  return out;
}

/* ------------------------------------------------------- after the days */

/**
 * Up to twelve design passes, spread across the weeks. The oldest is disputed
 * and corrected, the next two are upheld, and the rest wait in the open queue,
 * because faculty work the queue oldest first.
 */
function allocateDisagreements(
  passes: Array<{ login: string; slug: string; daysAgo: number; minute: number }>,
): PlannedDisagreement[] {
  const ordered = [...passes].sort((a, b) => b.daysAgo - a.daysAgo || a.minute - b.minute);
  const take = Math.min(12, ordered.length);
  const chosen = Array.from({ length: take }, (_, i) =>
    ordered[Math.floor((i * ordered.length) / take)]!);
  const upheld = Math.min(2, Math.max(0, take - 2));

  return chosen.map((pass, index): PlannedDisagreement => {
    const reviewDay = Math.max(0, pass.daysAgo - 2);
    // Two steps apart either way, weak against strong or adequate against
    // off_question, so consolidate() holds the lower and marks a disagreement.
    const bands: PlannedDisagreement["bands"] = index % 4 === 3
      ? { pretrained: "adequate", llm: "off_question" }
      : { pretrained: "weak", llm: "strong" };
    const base = { login: pass.login, slug: pass.slug, bands };
    if (index === 0) {
      return { ...base, bands: { pretrained: "weak", llm: "strong" },
               review: { daysAgo: reviewDay, disposition: "disputed", note: NOTES.disputed },
               override: { band: "strong", note: NOTES.override } };
    }
    if (index <= upheld) {
      return { ...base,
               review: { daysAgo: reviewDay, disposition: "upheld", note: NOTES.upheld },
               override: null };
    }
    return { ...base, review: null, override: null };
  });
}

/**
 * Four submissions leased and never written, which is what a lost message
 * looks like, and four voice answers waiting on a scorer: two because it is
 * not running and two because the judge gave up. Each submission goes to a
 * problem its learner never touched, so no cap from the day's sittings is in
 * the way.
 */
function stuckRows(
  people: Person[], states: Map<string, LearnerState>, catalogue: Catalogue,
  problems: Map<string, CatalogueProblem>,
  voice: Array<{ person: Person; action: VoiceAction; daysAgo: number }>,
): { submissions: StuckSubmission[]; voice: StuckVoice[] } {
  const working = people.filter((p) => practises(p) && p.state === "active" &&
    p.archetype !== "lapsed");
  const taken = new Set<string>();
  const submissions: StuckSubmission[] = [];
  let cursor = 0;
  for (const minutesAgo of [7, 40, 180, 2880]) {
    for (let tries = 0; tries < working.length; tries += 1) {
      const person = working[cursor++ % working.length]!;
      const state = states.get(person.login)!;
      const slug = catalogue.paths[state.persona].find((s) =>
        !state.touched.has(s) && !taken.has(`${person.login}:${s}`) &&
        problems.get(s)!.artefactType === "code" && !locked(state, catalogue, problems.get(s)!));
      if (!slug) continue;
      taken.add(`${person.login}:${slug}`);
      submissions.push({ login: person.login, slug, minutesAgo,
        learnerTest: tierFor(problems.get(slug)!.difficulty).requiresLearnerTests });
      break;
    }
    if (submissions.length === 0 || submissions[submissions.length - 1]!.minutesAgo !== minutesAgo) {
      throw new Error("no learner has an untouched code problem left for a stuck submission");
    }
  }

  const questions = [...new Set(voice.map((v) => v.action.question))];
  const pool = questions.length ? questions : catalogue.questions.map((q) => q.slug);
  const stuckVoice: StuckVoice[] = [
    { minutesAgo: 75, judge: "never" as const },
    { minutesAgo: 240, judge: "never" as const },
    { minutesAgo: 180, judge: "gives_up" as const },
    { minutesAgo: 1440, judge: "gives_up" as const },
  ].map((row, index) => ({
    ...row,
    login: working[(index + 1) % working.length]!.login,
    question: pool[index % pool.length]!,
  }));

  return { submissions, voice: stuckVoice };
}

function expectedFrom(
  people: Person[], sittings: Sitting[], disagreements: PlannedDisagreement[],
  stuck: { submissions: StuckSubmission[]; voice: StuckVoice[] },
  csvRows: Array<{ login: string; persona: Persona }>, refusedRetry: boolean,
): Expected {
  const actions = sittings.flatMap((s) => s.actions);
  const attempts = actions.filter((a): a is AttemptAction => a.type === "attempt");
  const rehearsals = actions.filter((a): a is RehearsalAction => a.type === "rehearsal");
  const voice = actions.filter((a) => a.type === "voice").length;
  const invites = actions.filter((a): a is InviteAction => a.type === "invite");
  const redeemed = new Set(actions.flatMap((a) => (a.type === "redeem" ? [a.invite] : [])));
  const withdrawn = new Set(actions.flatMap((a) => (a.type === "withdraw" ? [a.invite] : [])));
  const expired = invites.filter((i) => i.key === "expired").length;
  const enrolled = new Map(people.map((p) => [p.login, p.persona]));

  return {
    people: people.length,
    submissions:
      attempts.reduce((n, a) => n + a.runs + 1 + (a.defence !== undefined ? 1 : 0), 0) +
      rehearsals.reduce((n, r) => n + r.submits.length, 0) +
      stuck.submissions.length,
    voiceSessions: voice + stuck.voice.length,
    rehearsals: rehearsals.length,
    unfinishedRehearsals: rehearsals.filter((r) => !r.finished).length,
    consents: actions.filter((a) => a.type === "consent").length,
    invites: {
      pending: invites.length - redeemed.size - withdrawn.size - expired,
      used: redeemed.size,
      withdrawn: withdrawn.size,
      expired,
    },
    personaChanges: csvRows.filter((row) =>
      enrolled.has(row.login) && enrolled.get(row.login) !== row.persona).length,
    disagreements: {
      open: disagreements.filter((d) => !d.review).length,
      upheld: disagreements.filter((d) => d.review?.disposition === "upheld").length,
      overridden: disagreements.filter((d) => d.override).length,
    },
    stuck: {
      submissions: stuck.submissions.length,
      voiceNotScored: stuck.voice.filter((v) => v.judge === "never").length,
      voiceGaveUp: stuck.voice.filter((v) => v.judge === "gives_up").length,
    },
    refusedRetries: refusedRetry ? 1 : 0,
  };
}
