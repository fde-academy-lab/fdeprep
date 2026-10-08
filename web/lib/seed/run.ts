/**
 * Carrying a seed plan out through the production write paths.
 *
 * eval/ is the only writer of a grade, a band or a competency state, and this
 * file writes none of them. What reaches the database goes through the code a
 * learner's own work goes through:
 *
 *   a submission      createSubmission, dispatchOnce, receive, writeResult
 *                     (the verdict, the score, the competency cells and the
 *                     evaluation, all inside writeResult's transaction)
 *   a disagreement    runPanel over scripted panelists, then saveEvaluation
 *   a voice score     scoreVoiceOnce with a scripted judge reply
 *   a review          recordReview, and overrideBand for the one correction
 *
 * The scripted part is only ever the input: a result contract, a panelist's
 * finding, a judge's reply. Its own SQL is the roster (users, cohorts and
 * enrolments, which no production path creates outside an invite) and reads.
 *
 * Time: each step runs now and its rows are then moved back to the simulated
 * moment by lib/seed/rewind.ts, which can only touch timestamp columns.
 */
import { randomBytes } from "node:crypto";
import { parse } from "yaml";
import { db } from "../db/pool.ts";
import { applyPersonaCsv, clearCounter, toggleDegradedMode } from "../admin/index.ts";
import { revealHint, saveLearnerTest } from "../attempts/actions.ts";
import { resolveAccess } from "../auth/access.ts";
import { createInvite, revokeInvite } from "../auth/invite.ts";
import { complexityOf } from "../eval/from-result.ts";
import { overrideBand } from "../eval/override.ts";
import { runPanel, type Panelist, type PanelistResult } from "../eval/panel.ts";
import { saveEvaluation } from "../eval/record.ts";
import { recordReview } from "../eval/review.ts";
import { readinessForMany, type Readiness } from "../progress/readiness.ts";
import { dispatchOnce } from "../queue/dispatcher.ts";
import { writeResult } from "../queue/result-writer.ts";
import { deleteMessage, receive, type QueueMessage } from "../queue/shim.ts";
import { finishRehearsal, startRehearsal } from "../rehearsal/index.ts";
import { createSubmission, RateLimitError, type RunKind } from "../submissions/create.ts";
import { grantConsent } from "../voice/consent.ts";
import { scoreVoiceOnce } from "../voice/judge.ts";
import { finishSession, type TimelineIn } from "../voice/persist.ts";
import { MAX_JUDGE_ATTEMPTS } from "../voice/score.ts";
import { startVoiceSession } from "../voice/start.ts";
import { submitTypedAnswer, typedWordLimit } from "../voice/typed.ts";
import type { Band } from "../policy/bands.ts";
import type { Difficulty } from "../policy/tiers.ts";
import { contractFor, defenceContract, type ContractOutcome, type ContractProblem } from "./contracts.ts";
import { COHORTS, DEVELOPMENT, type Archetype, type CohortKey, type Person } from "./names.ts";
import {
  DEFAULT_SEED, type Action, type AttemptAction, type RehearsalAction, type SeedPlan, type Sitting,
  type VoiceAction,
} from "./plan.ts";
import { Random } from "./random.ts";
import { seedRowCounts } from "./replace.ts";
import { now, REWIND, rewindRows, rewindWindow, type RewindTable } from "./rewind.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The seed refuses to run rather than grade somebody else's work. */
export class SeedRefused extends Error {}

export interface Account { userId: number; enrolmentId: number; cohortId: number }

export interface SeedReport {
  accounts: Map<string, Account>;
  cohorts: Map<CohortKey, number>;
  /** The seed's own rows in each table, the ones --replace would remove. */
  counts: Array<{ table: string; rows: number }>;
  named: Array<{ login: string; displayName: string; readiness: Readiness }>;
  /** One login per archetype, for a reviewer to open. */
  archetypes: Array<{ archetype: Archetype; login: string }>;
}

interface Material extends ContractProblem {
  id: number;
  slug: string;
  stub: string;
  reference: string;
  complexity: string;
  exemplars: Map<string, string>;
}

interface SubmitExtra {
  hints?: number;
  band?: Band;
  defence?: number;
  rehearsalId?: number;
}

interface Question {
  id: number;
  totalSeconds: number;
  beats: Array<{ key: string; label: string; seconds: number }>;
  exemplars: Record<string, string>;
  rubric: Array<{ key: string; weight: number }>;
  followUps: Array<{ id: number; after: string }>;
}

export async function runSeed(
  plan: SeedPlan, options: { log?: (line: string) => void } = {},
): Promise<SeedReport> {
  const seeder = new Seeder(plan, options.log ?? (() => {}));
  // startVoiceSession refuses without these, and mints a token for a socket
  // the seed never opens. Placeholders in this process only, and only when
  // they are unset, so a configured deployment's values are never replaced.
  const placed = placeholders();
  try {
    return await seeder.run();
  } finally {
    for (const name of placed) delete process.env[name];
  }
}

function placeholders(): string[] {
  const placed: string[] = [];
  const values: Record<string, string> = {
    VOICE_SOCKET_URL: "ws://localhost/seed-never-connects",
    VOICE_TOKEN_SECRET: randomBytes(24).toString("hex"),
  };
  for (const [name, value] of Object.entries(values)) {
    if (process.env[name]) continue;
    process.env[name] = value;
    placed.push(name);
  }
  return placed;
}

/* ---------------------------------------------------------------- time */

const COUNTERS: readonly RewindTable[] = ["rate_limit_counter"];
const ALL_BUT_COUNTERS = (Object.keys(REWIND) as RewindTable[]).filter((t) => t !== "rate_limit_counter");

class Clock {
  constructor(public at: number) {}
  /** The current moment, then advance by `minutes`. */
  next(minutes: number): number {
    const at = this.at;
    this.at += minutes * MINUTE;
    return at;
  }
}

/* ---------------------------------------------------------------- seed */

class Seeder {
  private readonly accounts = new Map<string, Account>();
  private readonly cohorts = new Map<CohortKey, number>();
  private readonly materials = new Map<string, Material>();
  private readonly questions = new Map<string, Question>();
  private readonly invites = new Map<string, { id: number; token: string }>();
  private readonly drafts = new Map<string, number>();
  private readonly solved = new Set<string>();
  private readonly designPasses = new Map<string, { submissionId: number; at: number; body: string }>();
  private readonly people: Map<string, Person>;
  /**
   * Scores and call counts inside what the plan fixed. A stream of its own,
   * so a draw here never moves one the plan made.
   */
  private readonly variety = new Random(DEFAULT_SEED + 1);
  private readonly started = Date.now();
  /** Counter windows opened during the current sitting, moved when it ends. */
  private deferred: Array<{ from: string; to: string; ms: number }> | null = null;

  constructor(private readonly plan: SeedPlan, private readonly log: (line: string) => void) {
    this.people = new Map(plan.people.map((p) => [p.login, p]));
  }

  async run(): Promise<SeedReport> {
    await assertIdle();
    await this.enrol();
    this.log(`enrolled ${this.accounts.size} people in ${this.cohorts.size} cohorts`);

    let done = 0;
    for (const sitting of this.plan.sittings) {
      await this.sitting(sitting);
      done += 1;
      if (done % 50 === 0) this.log(`  ${done} of ${this.plan.sittings.length} sittings`);
    }
    this.log(`ran ${done} sittings`);

    await this.disagreements();
    await this.stuck();
    return this.report();
  }

  /* ------------------------------------------------------------ roster */

  private async enrol(): Promise<void> {
    for (const cohort of COHORTS) {
      const at = this.dayStart(cohort.startsDaysAgo, 8 * 60);
      await this.block(at, async () => {
        const { rows } = await db().query<{ id: string }>(
          `insert into cohort (slug, name, starts_on)
           values ($1, $2, current_date - $3::int) returning id`,
          [cohort.slug, cohort.name, cohort.startsDaysAgo]);
        const cohortId = Number(rows[0]!.id);
        this.cohorts.set(cohort.key, cohortId);

        // The development account first, so developmentLearner() lands on it.
        if (cohort.key === DEVELOPMENT.cohort) {
          await this.enrolOne({ ...DEVELOPMENT, state: "active" }, cohortId);
        }
        for (const person of this.plan.people) {
          if (person.cohort === cohort.key && !person.joinsByInvite) {
            await this.enrolOne(person, cohortId);
          }
        }
      });
    }
  }

  private async enrolOne(
    person: Pick<Person, "login" | "displayName" | "githubId" | "persona" | "role" | "state">,
    cohortId: number,
  ): Promise<void> {
    const { rows: user } = await db().query<{ id: string }>(
      `insert into app_user (github_id, github_login, display_name) values ($1, $2, $3)
       on conflict (github_id) do update
         set github_login = excluded.github_login, display_name = excluded.display_name
       returning id`,
      [person.githubId, person.login, person.displayName]);
    const { rows: enrolment } = await db().query<{ id: string }>(
      `insert into enrolment (user_id, cohort_id, persona, role, state)
       values ($1, $2, $3::persona, $4::app_role, $5::enrolment_state) returning id`,
      [user[0]!.id, cohortId, person.persona, person.role, person.state]);
    this.accounts.set(person.login, {
      userId: Number(user[0]!.id), enrolmentId: Number(enrolment[0]!.id), cohortId,
    });
  }

  private account(login: string): Account {
    const account = this.accounts.get(login);
    if (!account) throw new Error(`${login} is not enrolled yet`);
    return account;
  }

  /* ---------------------------------------------------------- sittings */

  /** Midnight UTC `daysAgo` days back, plus `minute`, never later than three hours ago. */
  private dayStart(daysAgo: number, minute: number): number {
    const midnight = Math.floor(this.started / DAY) * DAY;
    return Math.min(midnight - daysAgo * DAY + minute * MINUTE, this.started - 3 * HOUR);
  }

  /**
   * A learner's sitting, step by step. Each step moves back to its own minute
   * as soon as it is done, except the counter windows it opens: those move
   * when the sitting ends, so a second run in the sitting finds the window
   * the first one opened, as it would for a person.
   */
  private async sitting(sitting: Sitting): Promise<void> {
    const clock = new Clock(this.dayStart(sitting.daysAgo, sitting.minute));
    this.deferred = [];
    try {
      for (const action of sitting.actions) {
        await this.action(sitting.login, action, clock);
      }
    } finally {
      const deferred = this.deferred;
      this.deferred = null;
      for (const step of deferred) {
        await rewindWindow(db(), { from: step.from, to: step.to }, step.ms, COUNTERS);
      }
    }
  }

  /**
   * Run `work` now, then move every timestamp it wrote back so that its start
   * lands at `at`. `earlierMs` widens the window backwards for a step that
   * moves its own start before running, as a spoken answer does.
   */
  private async block<T>(at: number, work: () => Promise<T>, earlierMs = 0): Promise<T> {
    const from = await now(db(), earlierMs);
    const result = await work();
    const to = await now(db());
    const ms = from.ms + earlierMs - at;
    if (this.deferred) {
      await rewindWindow(db(), { from: from.at, to: to.at }, ms, ALL_BUT_COUNTERS);
      this.deferred.push({ from: from.at, to: to.at, ms });
    } else {
      await rewindWindow(db(), { from: from.at, to: to.at }, ms);
    }
    return result;
  }

  private async action(login: string, action: Action, clock: Clock): Promise<void> {
    switch (action.type) {
      case "consent":
        await this.block(clock.next(1), () => grantConsent(this.account(login).enrolmentId));
        return;
      case "attempt":
        await this.attempt(login, action, clock);
        return;
      case "rehearsal":
        await this.rehearsal(login, action, clock);
        return;
      case "voice":
        await this.voice(login, action, clock);
        return;
      case "invite": {
        const created = await this.block(clock.next(2), () => createInvite({
          cohortId: this.cohorts.get(action.cohort)!, actorId: this.account(login).userId,
          role: action.role, persona: action.persona, githubLogin: action.githubLogin,
          note: action.note, expiresInDays: action.days,
        }));
        this.invites.set(action.key, { id: created.id, token: created.token });
        return;
      }
      case "withdraw": {
        const invite = this.invites.get(action.invite)!;
        const withdrawn = await this.block(clock.next(1), () =>
          revokeInvite(invite.id, this.account(login).userId));
        if (!withdrawn) throw new Error(`invite ${action.invite} could not be withdrawn`);
        return;
      }
      case "redeem":
        await this.redeem(login, action.invite, clock);
        return;
      case "persona_csv": {
        const result = await this.block(clock.next(3), () => applyPersonaCsv(action.rows, {
          actorId: this.account(login).userId, cohortId: this.cohorts.get(action.cohort)!,
        }));
        if (result.errors.length) throw new Error(`persona CSV: ${result.errors.join("; ")}`);
        return;
      }
      case "degraded":
        await this.block(clock.next(20), async () => {
          const actor = this.account(login).userId;
          await toggleDegradedMode(true, action.reason, actor);
          await toggleDegradedMode(false, null, actor);
        });
        return;
    }
  }

  private async redeem(login: string, key: string, clock: Clock): Promise<void> {
    const person = this.people.get(login)!;
    const invite = this.invites.get(key)!;
    const access = await this.block(clock.next(2), () => resolveAccess(
      { id: person.githubId, login, name: person.displayName, avatarUrl: null, email: null },
      false, { orgRequired: false, inviteToken: invite.token }));
    if (!access.ok) throw new Error(`${login} could not redeem the invite: ${access.reason}`);
    this.accounts.set(login, {
      userId: access.userId, enrolmentId: access.enrolmentId, cohortId: access.cohortId,
    });
  }

  /* ---------------------------------------------------------- problems */

  private async attempt(login: string, action: AttemptAction, clock: Clock): Promise<void> {
    const account = this.account(login);
    const material = await this.material(action.slug);
    const where = { enrolmentId: account.enrolmentId, cohortId: account.cohortId,
                    problemId: material.id };

    for (let run = 0; run < action.runs; run += 1) {
      // The last run before a clean submit passes half the time, as a learner
      // runs until it passes and then submits. Only there: a passing run is a
      // clean cell, and the plan gives a clean cell to a clean submit alone.
      const passes = run === action.runs - 1 && action.outcome === "clean" &&
        this.variety.chance(0.5);
      await this.submit(login, material, "run", passes ? "clean" : "run_fail", clock.next(8));
    }
    for (let hint = 0; hint < action.hints; hint += 1) {
      await this.block(clock.next(2), () => revealHint(where));
    }
    if (action.learnerTest) {
      await this.block(clock.next(4), () => saveLearnerTest({ ...where, body: LEARNER_TEST }));
    }

    // The planned refusal runs inside the submit's block, while the window the
    // submit opened is still open in real time and the cap can bind.
    const at = clock.next(9);
    const submitted = await this.block(at, async () => {
      const done = await this.submitNow(login, material, "submit", action.outcome,
        { hints: action.hints, band: action.band });
      if (action.refusedRetry) await this.refusedRetry(login, material);
      return done;
    });
    const passed = action.outcome === "clean" || action.outcome === "hinted" ||
      action.outcome === "over_budget";
    if (passed) this.solved.add(`${login}:${action.slug}`);
    if (passed && material.artefactType === "design") {
      this.designPasses.set(`${login}:${action.slug}`, { submissionId: submitted.id, at,
                                                         body: submitted.body });
    }

    if (action.defence !== undefined) {
      await this.submit(login, material, "defence", "clean", clock.next(6),
        { defence: action.defence });
    }
  }

  /**
   * The one planned refusal: a second submit the same day on a problem that
   * allows one. It is refused by the cap or by the hash before anything is
   * written, and it is caught here and nowhere else.
   */
  private async refusedRetry(login: string, material: Material): Promise<void> {
    const account = this.account(login);
    const before = await submissionCount(account.enrolmentId, material.id);
    try {
      await createSubmission({
        enrolmentId: account.enrolmentId, cohortId: account.cohortId, problemId: material.id,
        kind: "submit", body: this.body(login, material, "submit"),
      });
    } catch (error) {
      if (!(error instanceof RateLimitError)) throw error;
      if (await submissionCount(account.enrolmentId, material.id) !== before) {
        throw new Error("a refused submit left a row behind");
      }
      return;
    }
    throw new Error(`the cap let ${login} submit ${material.slug} twice in a day`);
  }

  /** One submission through the record path, in a block of its own at `at`. */
  private async submit(
    login: string, material: Material, kind: RunKind, outcome: ContractOutcome, at: number,
    extra: SubmitExtra = {},
  ): Promise<{ id: number; body: string }> {
    return this.block(at, () => this.submitNow(login, material, kind, outcome, extra));
  }

  /** One submission through the record path, inside the caller's block. */
  private async submitNow(
    login: string, material: Material, kind: RunKind, outcome: ContractOutcome,
    extra: SubmitExtra = {},
  ): Promise<{ id: number; body: string }> {
    const account = this.account(login);
    const body = this.body(login, material, kind, extra.band ?? (outcome === "fail" ? "weak" : undefined));
    const quote = words(body).slice(0, 8).join(" ");
    const contract = kind === "defence"
      ? defenceContract(material, extra.defence!, quote)
      : contractFor(material, outcome, {
          hints: extra.hints ?? 0, band: extra.band, quote,
          alreadyPassed: this.solved.has(`${login}:${material.slug}`),
          random: this.variety,
          run: kind === "run",
        });

    const created = await createSubmission({
      enrolmentId: account.enrolmentId, cohortId: account.cohortId, problemId: material.id,
      kind, body, rehearsalId: extra.rehearsalId,
    });
    await dispatchOnce();
    const lane = material.artefactType === "code" && kind !== "defence" ? "submissions" : "judgements";
    const message = await claim(lane, created.id);
    const committed = await writeResult({
      submission_id: created.id,
      lease_token: String(message.body["lease_token"]),
      fencing_token: Number(message.body["fencing_token"]),
      body_sha256: created.bodySha256,
      result: contract,
    });
    if (!committed) throw new Error(`writeResult did not commit submission ${created.id}`);
    await deleteMessage(message.id);
    return { id: created.id, body };
  }

  /**
   * What the learner sent. Code is the problem's starter code with a draft
   * line, a prompt or a design answer is the authored exemplar for the band,
   * and a defence is the opening of the authored walkthrough. Every draft on
   * an attempt differs, because Extreme refuses a byte-identical resubmission.
   */
  private body(login: string, material: Material, kind: RunKind, band?: Band): string {
    const key = `${login}:${material.slug}`;
    const draft = (this.drafts.get(key) ?? 0) + 1;
    this.drafts.set(key, draft);
    if (kind === "defence") return sentencesUpTo(material.reference, 100);
    if (material.artefactType === "code") return `${material.stub.trimEnd()}\n\n# draft ${draft}\n`;
    const text = material.exemplars.get(band ?? "strong") ?? material.exemplars.get("strong") ??
      material.stub;
    return text.trimEnd() + "\n".repeat(draft);
  }

  /**
   * A sitting runs as one block: createSubmission refuses a rehearsal submit
   * once ends_at has passed, so the sitting's rows move back in time only
   * after its last submit.
   */
  private async rehearsal(login: string, action: RehearsalAction, clock: Clock): Promise<void> {
    const account = this.account(login);
    await this.block(clock.next(60), async () => {
      const sitting = await startRehearsal(account.enrolmentId);
      const drawn = sitting.problems.map((p) => p.slug);
      if (drawn.join() !== action.drawn.join()) {
        throw new Error(`the rehearsal drew ${drawn.join(", ")}; the plan expected ` +
                        action.drawn.join(", "));
      }
      for (const submit of action.submits) {
        await this.submitNow(login, await this.material(submit.slug), "rehearsal_submit",
          submit.outcome, { band: submit.band, rehearsalId: sitting.id });
      }
      if (action.finished) await finishRehearsal(sitting.id);
    });
  }

  /* -------------------------------------------------------------- voice */

  private async voice(login: string, action: VoiceAction, clock: Clock): Promise<void> {
    const account = this.account(login);
    const question = await this.question(action.question);
    const exemplar = question.exemplars[action.band] ?? Object.values(question.exemplars)[0]!;
    const spoken = new Random(action.order).shuffle(sentences(exemplar)).join(" ");

    if (action.input === "typed") {
      const text = sentencesUpTo(spoken, typedWordLimit(question.totalSeconds));
      await this.block(clock.next(5), async () => {
        const id = await submitTypedAnswer({
          enrolmentId: account.enrolmentId, cohortId: account.cohortId,
          voiceQuestionId: question.id, mode: action.mode === "unguided" ? "unguided" : "guided", text,
        });
        await scoreOnly(id, scriptedJudge(question, action, text));
      });
      return;
    }

    const transcript = action.short ? words(exemplar).slice(0, 18).join(" ") : spoken;
    const durationMs = action.short ? 0 : action.durationS * 1000;
    await this.block(clock.next(Math.ceil(action.durationS / 60) + 3), async () => {
      const started = await startVoiceSession({
        enrolmentId: account.enrolmentId, cohortId: account.cohortId,
        voiceQuestionId: question.id, mode: action.mode,
      });
      // The answer ran for its planned length, so the server's own clock in
      // finishSession counts it and the pace score has a duration to read.
      if (durationMs) {
        await rewindRows(db(), "voice_session", [started.sessionId], durationMs, ["started_at"]);
      }
      await finishSession({
        sessionId: started.sessionId,
        enrolmentId: account.enrolmentId,
        transcript,
        segments: segmentsFor(transcript, durationMs),
        timeline: timelineFor(question, action, durationMs),
      });
      if (action.short) {
        await expectNotCounted(started.sessionId);
        return;
      }
      await scoreOnly(started.sessionId, scriptedJudge(question, action, transcript));
    }, durationMs);
  }

  /* ---------------------------------------------- after the last sitting */

  /**
   * A second, newer evaluation for each planned design pass, from a panel
   * whose two model panelists land two bands apart. consolidate() marks the
   * disagreement and holds the lower band; the seed types neither. Then the
   * planned reviews, and the one correction through the faculty override.
   */
  private async disagreements(): Promise<void> {
    const reviewer = this.account(this.plan.faculty).userId;
    const reviews: Array<{ at: number; evaluationId: number;
                           planned: SeedPlan["disagreements"][number] }> = [];

    for (const planned of this.plan.disagreements) {
      const key = `${planned.login}:${planned.slug}`;
      const pass = this.designPasses.get(key);
      if (!pass) throw new Error(`no design pass recorded for ${key}`);
      const material = await this.material(planned.slug);
      const enrolmentId = this.account(planned.login).enrolmentId;
      const { rows } = await db().query<{ score: string }>(
        "select score from submission where id = $1", [pass.submissionId]);

      const evaluation = await this.block(pass.at + HOUR, async () => {
        const panel = await runPanel({
          submissionId: pass.submissionId,
          complexity: complexityOf("design", material.complexity),
          artefactType: "design",
          body: pass.body,
          problemSlug: planned.slug,
        }, [
          fake("static", { status: "ran", ms: 4, findings: [], verdict: "pass",
                           scoreContribution: Number(rows[0]!.score) }),
          fake("pretrained", { status: "ran", ms: 190, findings: [], band: planned.bands.pretrained }),
          fake("llm", { status: "ran", ms: 2400, findings: [], band: planned.bands.llm }),
        ]);
        if (!panel.disagreement) throw new Error(`the panel for ${key} did not disagree`);
        return saveEvaluation(panel, enrolmentId, db());
      });

      if (planned.review) {
        const at = Math.max(this.dayStart(planned.review.daysAgo, 10 * 60), pass.at + 2 * HOUR);
        reviews.push({ at, evaluationId: evaluation, planned });
      }
    }

    for (const { at, evaluationId, planned } of reviews.sort((a, b) => a.at - b.at)) {
      await this.block(at, async () => {
        await recordReview({ evaluationId, reviewerId: reviewer,
                             disposition: planned.review!.disposition, note: planned.review!.note });
        if (planned.override) {
          await overrideBand({ evaluationId, reviewerId: reviewer,
                               band: planned.override.band, note: planned.override.note });
        }
      });
    }
  }

  /**
   * Four voice answers waiting on a scorer, then four submissions whose
   * message was lost, then the attempt an admin gave back for the oldest.
   */
  private async stuck(): Promise<void> {
    for (const row of this.plan.stuck.voice) {
      const account = this.account(row.login);
      const question = await this.question(row.question);
      const text = sentencesUpTo(
        question.exemplars["adequate"] ?? Object.values(question.exemplars)[0]!,
        typedWordLimit(question.totalSeconds));
      await this.block(this.started - row.minutesAgo * MINUTE, async () => {
        const id = await submitTypedAnswer({
          enrolmentId: account.enrolmentId, cohortId: account.cohortId,
          voiceQuestionId: question.id, mode: "guided", text,
        });
        if (row.judge === "never") return;
        for (let attempt = 0; attempt < MAX_JUDGE_ATTEMPTS; attempt += 1) {
          await scoreVoiceOnce({ sessionId: id, invoke: async () =>
            ({ status: "error", message: "The judge could not reach the model." }) });
        }
        const { rows } = await db().query<{ attempts: number; spent: boolean }>(
          "select judge_attempts as attempts, spent_allowance as spent from voice_session where id = $1",
          [id]);
        if (rows[0]!.attempts !== MAX_JUDGE_ATTEMPTS || rows[0]!.spent) {
          throw new Error(`voice session ${id} was not given up on`);
        }
      });
    }

    for (const row of this.plan.stuck.submissions) {
      const account = this.account(row.login);
      const material = await this.material(row.slug);
      await this.block(this.started - row.minutesAgo * MINUTE, async () => {
        const where = { enrolmentId: account.enrolmentId, cohortId: account.cohortId,
                        problemId: material.id };
        if (row.learnerTest) await saveLearnerTest({ ...where, body: LEARNER_TEST });
        const created = await createSubmission({ ...where, kind: "submit",
                                                 body: this.body(row.login, material, "submit") });
        await dispatchOnce();
        // Taken off the lane and never answered: the lease is held, nothing
        // comes back, and the queue is empty. That is a lost message.
        await deleteMessage((await claim("submissions", created.id)).id);
      });
    }

    const clear = this.plan.counterClear;
    const target = this.account(clear.login);
    await this.block(this.started - clear.minutesAgo * MINUTE, async () => {
      const cleared = await clearCounter(
        { enrolmentId: target.enrolmentId, scope: "submit_daily",
          problemId: (await this.material(clear.slug)).id },
        clear.reason, this.account(this.plan.admin).userId);
      if (!cleared) throw new Error("the counter clear found nothing to clear");
    });
  }

  /* ------------------------------------------------------------ report */

  private async report(): Promise<SeedReport> {
    const named = this.plan.people.filter((p) => p.named).sort((a, b) => a.named! - b.named!);
    const readiness = await readinessForMany(named.map((p) => this.account(p.login).enrolmentId));
    const archetypes = (["steady", "sprinter", "stalled", "lapsed", "new"] as const).map((archetype) => ({
      archetype,
      login: this.plan.people.find((p) => p.archetype === archetype && p.role === "learner")!.login,
    }));
    return {
      accounts: this.accounts,
      cohorts: this.cohorts,
      counts: await seedRowCounts(),
      named: named.map((p) => ({
        login: p.login, displayName: p.displayName,
        readiness: readiness.get(this.account(p.login).enrolmentId)!,
      })),
      archetypes,
    };
  }

  /* --------------------------------------------------------- catalogue */

  private async material(slug: string): Promise<Material> {
    const cached = this.materials.get(slug);
    if (cached) return cached;
    const { rows } = await db().query<{
      id: string; difficulty: Difficulty; artefact_type: Material["artefactType"];
      call_budget: number | null; time_limit_s: number; stub_code: string | null;
      original_prompt: string | null; reference_md: string | null; source_yaml: string;
      defence_criterion: { label: string; weight: number } | null;
      tests: Array<{ name: string; visibility: "public" | "hidden" | "adversarial" }>;
    }>(
      `select p.id, p.difficulty::text as difficulty, p.artefact_type::text as artefact_type,
              v.call_budget, v.time_limit_s, v.stub_code, v.original_prompt, v.reference_md,
              v.source_yaml, v.defence_criterion,
              coalesce((select json_agg(json_build_object('name', t.name,
                                                          'visibility', t.visibility)
                                        order by t.ordinal)
                          from problem_test t where t.problem_version_id = v.id), '[]') as tests
         from problem p
         join problem_version v on v.problem_id = p.id and v.version = p.current_version
        where p.slug = $1`, [slug]);
    const row = rows[0];
    if (!row) throw new Error(`${slug} is not in the catalogue`);

    const source = (parse(row.source_yaml) ?? {}) as {
      complexity?: string;
      exemplars?: Array<{ band?: string; body_md?: string; score?: number }>;
      rubric?: Array<{ label?: string; weight?: number }>;
      probes?: Array<{ name?: string; assertion?: { type?: string } }>;
      prompt_rules?: Array<{ kind?: string; label?: string }>;
    };
    const exemplars = (source.exemplars ?? []).filter((e) => e.band && e.body_md);
    const adequate = exemplars.find((e) => e.band === "adequate")?.score;
    const visible = (v: string) => row.tests.filter((t) => t.visibility === v).map((t) => t.name);

    const material: Material = {
      id: Number(row.id),
      slug,
      difficulty: row.difficulty,
      artefactType: row.artefact_type,
      callBudget: row.call_budget,
      timeLimitS: row.time_limit_s,
      tests: { public: visible("public"), hidden: visible("hidden"), adversarial: visible("adversarial") },
      probes: (source.probes ?? []).map((p, i) => ({ name: p.name ?? `probe ${i + 1}`,
                                                      type: p.assertion?.type ?? "present" })),
      rules: (source.prompt_rules ?? []).map((r) => ({ kind: r.kind ?? "", label: r.label ?? "" })),
      rubric: (source.rubric ?? []).map((c, i) => ({ id: `c${i + 1}`, label: c.label ?? "",
                                                      weight: Number(c.weight ?? 0) })),
      threshold: adequate === undefined ? null : Number(adequate),
      defenceCriterion: row.defence_criterion,
      stub: row.stub_code ?? row.original_prompt ?? "",
      reference: row.reference_md ?? "",
      complexity: source.complexity ?? "",
      exemplars: new Map(exemplars.map((e) => [e.band!, e.body_md!])),
    };
    this.materials.set(slug, material);
    return material;
  }

  private async question(slug: string): Promise<Question> {
    const cached = this.questions.get(slug);
    if (cached) return cached;
    const { rows } = await db().query<{
      id: string; total_seconds: number; beats: Question["beats"];
      exemplars: Record<string, string> | null; rubric: Question["rubric"] | null;
      follow_ups: Question["followUps"] | null;
    }>(
      `select q.id, q.total_seconds,
              (select json_agg(json_build_object('key', b.beat_key, 'label', b.label,
                                                 'seconds', b.seconds) order by b.ordinal)
                 from voice_beat b where b.voice_question_id = q.id) as beats,
              (select json_object_agg(e.band, e.transcript)
                 from voice_exemplar e where e.voice_question_id = q.id) as exemplars,
              (select json_agg(json_build_object('key', c.criterion_key, 'weight', c.weight)
                               order by c.ordinal)
                 from voice_rubric_criterion c where c.voice_question_id = q.id) as rubric,
              (select json_agg(json_build_object('id', f.id, 'after', f.trigger_after_beat)
                               order by f.ordinal)
                 from voice_follow_up f
                where f.voice_question_id = q.id and f.retired_at is null) as follow_ups
         from voice_question q where q.slug = $1`, [slug]);
    const row = rows[0];
    if (!row?.exemplars) throw new Error(`voice question ${slug} has no exemplars to answer from`);
    const question: Question = {
      id: Number(row.id), totalSeconds: row.total_seconds, beats: row.beats,
      exemplars: row.exemplars, rubric: row.rubric ?? [],
      followUps: (row.follow_ups ?? []).map((f) => ({ id: Number(f.id), after: f.after })),
    };
    this.questions.set(slug, question);
    return question;
  }
}

/* -------------------------------------------------------------- helpers */

/** What a learner on Extreme writes before Submit opens. It asserts, so the gate counts it. */
const LEARNER_TEST = `def test_answers_with_text():
    assert isinstance(run_agent("Where is my order?", llm, tools), str)
`;

/**
 * Refuse rather than grade somebody else's work. The seed publishes each
 * submission's message and takes it straight back off the lane, so another
 * message waiting there would be picked up and given the seed's scripted
 * result. Voice answers need no check: the seed scores its own by id, and an
 * answer somebody else left waiting stays waiting.
 */
async function assertIdle(): Promise<void> {
  const { rows } = await db().query<{ outbox: number; lanes: number }>(
    `select (select count(*) from outbox where sent_at is null)::int as outbox,
            (select count(*) from queue_message
              where deleted_at is null and queue in ('submissions', 'judgements'))::int as lanes`);
  const { outbox, lanes } = rows[0]!;
  if (outbox + lanes > 0) {
    throw new SeedRefused(`${outbox + lanes} submissions are waiting on the queue, and the seed ` +
      "would pick them up as its own. Run npm run worker until the queue drains, then seed again.");
  }
}

/** The message the dispatcher published for this submission, from its lane. */
async function claim(lane: "submissions" | "judgements", submissionId: number): Promise<QueueMessage> {
  for (let round = 0; round < 3; round += 1) {
    const hit = (await receive(lane, 10)).find((m) => Number(m.body["submission_id"]) === submissionId);
    if (hit) return hit;
  }
  throw new Error(`no message for submission ${submissionId} on the ${lane} lane`);
}

async function submissionCount(enrolmentId: number, problemId: number): Promise<number> {
  const { rows } = await db().query<{ n: number }>(
    `select count(*)::int as n from submission s join attempt a on a.id = s.attempt_id
      where a.enrolment_id = $1 and a.problem_id = $2`, [enrolmentId, problemId]);
  return rows[0]!.n;
}

function fake(name: Panelist["name"], result: PanelistResult): Panelist {
  return { name, run: async () => result };
}

/** Score one finished answer by its id, and check it was scored. */
async function scoreOnly(
  sessionId: number, invoke: (event: Record<string, unknown>) => Promise<Record<string, unknown>>,
): Promise<void> {
  await scoreVoiceOnce({ sessionId, invoke });
  const { rows } = await db().query<{ scored: boolean }>(
    "select scored_at is not null as scored from voice_session where id = $1", [sessionId]);
  if (!rows[0]?.scored) throw new Error(`voice session ${sessionId} was not scored`);
}

async function expectNotCounted(sessionId: number): Promise<void> {
  const { rows } = await db().query<{ skipped: string | null }>(
    "select judge_result ->> 'skipped' as skipped from voice_session where id = $1", [sessionId]);
  if (rows[0]?.skipped !== "did_not_count") {
    throw new Error(`voice session ${sessionId} was planned not to count and it counted`);
  }
}

/**
 * The judge's reply, scripted to the plan: content points out of fifty spread
 * over the rubric, the first `covered` beats covered, and a one-sentence
 * summary built from the authored beat labels.
 */
function scriptedJudge(question: Question, action: VoiceAction, transcript: string) {
  const fraction = action.contentPoints / 50;
  const quote = words(transcript).slice(0, 8).join(" ");
  const missed = question.beats[action.covered];
  const summary = missed
    ? `The answer never reached the beat "${missed.label}".`
    : `The answer reached every beat, closing on "${question.beats[question.beats.length - 1]!.label}".`;
  return async (event: Record<string, unknown>) => {
    if (String(event["transcript"] ?? "").trim() !== transcript.trim()) {
      throw new Error("the scorer handed the seed a voice answer it did not write");
    }
    return {
      status: "ok",
      content_points: action.contentPoints,
      content_out_of: 50,
      criteria: question.rubric.map((c) => ({
        criterion_id: c.key, score: Math.round(c.weight * fraction), evidence_quote: quote,
        grounded: true,
      })),
      beats: question.beats.map((b, i) => ({
        beat_key: b.key, covered: i < action.covered, evidence_quote: i < action.covered ? quote : "",
      })),
      summary,
      model_calls: 2,
    };
  };
}

/**
 * The cockpit's record: covered beats reached in order and inside budget,
 * the last of a partial answer stretching past its seconds, one nudge, and
 * in pressure mode the interviewer cutting in at the end of each trigger beat.
 */
function timelineFor(question: Question, action: VoiceAction, durationMs: number): TimelineIn {
  const total = question.beats.reduce((sum, b) => sum + b.seconds, 0) * 1000;
  const scale = durationMs && total ? durationMs / total : 0;
  let at = 0;
  const ends = new Map<string, number>();
  const beats = question.beats.map((beat, index) => {
    if (action.short || index >= action.covered) {
      return { beatKey: beat.key, liveCovered: false, reachedAtMs: null, spentMs: 0,
               paceState: "never_reached" as const };
    }
    const stretched = index === action.covered - 1 && action.covered < question.beats.length;
    const spentMs = Math.round(beat.seconds * 1000 * (stretched ? 1.4 : scale));
    const reachedAtMs = at;
    at += spentMs;
    ends.set(beat.key, at);
    return { beatKey: beat.key, liveCovered: true, reachedAtMs, spentMs,
             paceState: stretched ? "stretching" as const : "on_budget" as const };
  });
  return {
    beats,
    nudges: action.short ? [] : [{ atMs: Math.min(25_000, Math.round(durationMs / 3)),
                                   kind: "silence", line: "Say the next step out loud.",
                                   wasShown: action.mode !== "unguided" }],
    interruptions: action.mode !== "pressure" ? [] : question.followUps
      .filter((f) => ends.has(f.after))
      .map((f) => ({ followUpId: f.id, firedAtMs: ends.get(f.after)!,
                     endedAtMs: ends.get(f.after)! + 8_000 })),
  };
}

function segmentsFor(transcript: string, durationMs: number) {
  const parts = sentences(transcript);
  const total = Math.max(1, words(transcript).length);
  const span = durationMs || 12_000;
  let at = 0;
  return parts.map((text) => {
    const length = Math.round((words(text).length / total) * span * 0.9);
    const segment = { text, startMs: at, endMs: at + length };
    at += length + Math.round((span * 0.1) / parts.length);
    return segment;
  });
}

function words(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

function sentences(text: string): string[] {
  return text.replace(/\s+/g, " ").trim().split(/(?<=[.?!])\s+/).filter(Boolean);
}

/** Whole sentences, as many as fit in `limit` words, or the first `limit` words. */
function sentencesUpTo(text: string, limit: number): string {
  const kept: string[] = [];
  let count = 0;
  for (const sentence of sentences(text)) {
    const n = words(sentence).length;
    if (count + n > limit) break;
    kept.push(sentence);
    count += n;
  }
  return kept.length ? kept.join(" ") : words(text).slice(0, limit).join(" ");
}
