/**
 * What the client is allowed to see.
 *
 * docs/03 section 5: `cases` is empty for hidden and adversarial gates unless
 * the learner has already passed the problem. That trimming happens here, on
 * the server, so a hidden case name cannot reach the browser and be read out
 * of the network tab.
 *
 * A Run shows the static and public gates and no score, whether or not the
 * problem is passed, because a Run executes the public cases only (docs/00
 * section 4). A Run row written before 8 October 2026 carries the whole
 * battery, and this is where it stops.
 *
 * What the learner reads of the hidden and adversarial gates is the tier's to
 * say, and the policy module says which tier a result reads under. Extreme and
 * screen conditions show nothing about the tests (docs/00 section 3.2), so
 * there both gates report whether they passed and nothing else. Every reader
 * of a result goes through here: the result pane, the event stream, the
 * polling route and the Attempts tab, through countsUnpublished.
 */
import { db } from "../db/pool.ts";
import { SITTING_SQL, tierForResult, type Difficulty } from "../policy/index.ts";
import { withheldGate } from "./run-contract.ts";

export interface GateView {
  status: "pass" | "fail" | "skipped";
  passed: number;
  total: number;
  cases: Array<{ name: string; status: string; message: string | null }>;
}

/** The prompt gate's checklist, which carries labels rather than case names. */
export interface CheckView {
  kind: string;
  label: string;
  status: "pass" | "fail";
  message: string | null;
}

export interface ProbeView {
  status: "pass" | "fail" | "skipped";
  passed: number;
  total: number;
  cases: Array<{
    name: string;
    status: string;
    detail: string | null;
    assertionType: string;
    /** docs/01 S5: null until the learner has passed the problem. */
    userMessage: string | null;
    response: string | null;
  }>;
}

export interface RubricView {
  status: "pass" | "fail" | "skipped";
  percent: number | null;
  threshold: number | null;
  criteria: Array<{
    label: string;
    weight: number;
    score: number;
    evidenceQuote: string;
    quoteGrounded: boolean;
  }>;
}

/**
 * A grade a person changed after the panel set it. docs/10 section 9.7.
 *
 * Carries no reviewer name. Faculty see who on the record; a learner sees that
 * a person reviewed it, which way it went and why. Naming the individual to a
 * learner invites them to lobby that person, and the decision belongs to the
 * programme rather than to whoever happened to read it.
 */
export interface CorrectionView {
  direction: "raised" | "lowered";
  note: string;
  at: string;
}

/**
 * docs/01 S4: one step of the checklist. Green when a public case satisfied
 * its check and the untouched stub did not; unchecked when the stub satisfies
 * it too, because then the public cases cannot tell the learner's work from
 * no work.
 */
export interface StepView {
  id: string;
  status: "pass" | "fail" | "unchecked";
}

/** The runner's step statuses, kept only where they have the contract's shape. */
export function trimSteps(value: unknown): StepView[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const step = entry as { id?: unknown; status?: unknown } | null;
    if (typeof step?.id !== "string") return [];
    if (step.status !== "pass" && step.status !== "fail" && step.status !== "unchecked") return [];
    return [{ id: step.id, status: step.status }];
  });
}

export interface SubmissionView {
  id: number;
  status: "queued" | "running" | "evaluating" | "terminal";
  verdict: string | null;
  score: number | null;
  kind: string;
  queuedAt: string;
  finishedAt: string | null;
  gates: { static: GateView; public: GateView; hidden: GateView; adversarial: GateView };
  /**
   * False when the hidden and adversarial gates carry no count: on a Run,
   * which runs neither, and on a result whose tier shows nothing about the
   * tests. Their `passed` and `total` then read 0 and say nothing.
   */
  unpublishedCounts: boolean;
  /** Present on prompt and design submissions, empty on code. */
  checks: CheckView[];
  probes: ProbeView;
  rubric: RubricView;
  modelCalls: number | null;
  budget: Record<string, unknown> | null;
  message: string | null;
  /** Present only when faculty changed this grade. */
  correction: CorrectionView | null;
  /** Empty unless the run reached the public tests of a problem with steps. */
  steps: StepView[];
}

const EMPTY: GateView = { status: "skipped", passed: 0, total: 0, cases: [] };

function trimCorrection(evaluation: unknown): CorrectionView | null {
  const block = (evaluation ?? {}) as { correction?: Record<string, unknown> };
  const correction = block.correction;
  if (!correction) return null;
  const direction = correction["direction"];
  if (direction !== "raised" && direction !== "lowered") return null;
  return {
    direction,
    note: String(correction["note"] ?? ""),
    at: String(correction["at"] ?? ""),
  };
}

/**
 * Whether a learner reads the hidden and adversarial counts of a result.
 *
 * A Run never runs either battery. Otherwise the tier the result reads under
 * decides, which is a rehearsal submit's screen conditions, any result's while
 * a sitting holds its problem, or the problem's own tier (tierForResult).
 */
export function countsUnpublished(
  difficulty: Difficulty, kind: string, sitting: boolean,
): boolean {
  return kind !== "run" && tierForResult(difficulty, { kind, sitting }).visibility.hiddenCount;
}

export async function publicView(submissionId: number): Promise<SubmissionView> {
  const { rows } = await db().query<{
    id: string; status: SubmissionView["status"]; verdict: string | null;
    score: string | null; kind: string; queued_at: Date; finished_at: Date | null;
    result: Record<string, any> | null; solved_at: Date | null;
    difficulty: Difficulty; sitting: boolean;
  }>(
    `select s.id, s.status, s.verdict::text, s.score, s.kind::text,
            s.queued_at, s.finished_at, s.result, a.solved_at,
            p.difficulty::text as difficulty, ${SITTING_SQL} as sitting
       from submission s join attempt a on a.id = s.attempt_id
       join problem p on p.id = a.problem_id
      where s.id = $1`, [submissionId]);

  const row = rows[0];
  if (!row) throw new Error(`submission ${submissionId} not found`);

  const alreadyPassed = row.solved_at !== null;
  const gates = (row.result?.["gates"] ?? {}) as Record<string, any>;
  const run = row.kind === "run";
  const counted = countsUnpublished(row.difficulty, row.kind, row.sitting);
  const unpublished = (gate: Record<string, any> | undefined): GateView =>
    run ? withheldGate()
      // The tier shows nothing about the tests: whether the battery passed,
      // and no count or name, even once the problem is passed.
      : !counted ? { ...trim(gate, false), passed: 0, total: 0 }
      : trim(gate, alreadyPassed);

  return {
    id: Number(row.id),
    status: row.status,
    verdict: row.verdict,
    score: run || row.score === null ? null : Number(row.score),
    kind: row.kind,
    queuedAt: row.queued_at.toISOString(),
    finishedAt: row.finished_at?.toISOString() ?? null,
    gates: {
      static: trim(gates["static"], true),
      public: trim(gates["public"], true),
      hidden: unpublished(gates["hidden"]),
      adversarial: unpublished(gates["adversarial"]),
    },
    unpublishedCounts: counted,
    checks: trimChecks(gates["static"]),
    probes: trimProbes(gates["probes"], alreadyPassed),
    rubric: trimRubric(gates["rubric"]),
    modelCalls: row.result?.["model_calls"] === undefined
      ? null : Number(row.result["model_calls"]),
    budget: (row.result?.["budget"] ?? null) as Record<string, unknown> | null,
    correction: trimCorrection(row.result?.["evaluation"]),
    steps: trimSteps(row.result?.["steps"]),
    message: (row.result?.["message"] ?? null) as string | null,
  };
}

function trimChecks(gate: Record<string, any> | undefined): CheckView[] {
  const checks = (gate?.["checks"] ?? []) as Array<Record<string, unknown>>;
  return checks.map((check) => ({
    kind: String(check["kind"] ?? ""),
    label: String(check["label"] ?? ""),
    status: check["status"] === "pass" ? "pass" : "fail",
    message: check["message"] === null || check["message"] === undefined
      ? null : String(check["message"]),
  }));
}

/**
 * docs/01 S5: the probe's full input text is visible only after a pass, so
 * learners cannot tune to the probe wording. The judge already withholds it;
 * this is the second place it is withheld, because the cost of getting it
 * wrong is that every cohort after the first knows the probes.
 */
function trimProbes(gate: Record<string, any> | undefined, reveal: boolean): ProbeView {
  if (!gate) return { status: "skipped", passed: 0, total: 0, cases: [] };
  const cases = (gate["cases"] ?? []) as Array<Record<string, any>>;
  return {
    status: (gate["status"] ?? "skipped") as ProbeView["status"],
    passed: Number(gate["passed"] ?? 0),
    total: Number(gate["total"] ?? 0),
    cases: cases.map((probe) => ({
      name: String(probe["name"]),
      status: String(probe["status"]),
      detail: probe["detail"] === undefined ? null : String(probe["detail"]),
      assertionType: String(probe["assertion"]?.["type"] ?? ""),
      userMessage: reveal && probe["user_message"] ? String(probe["user_message"]) : null,
      response: reveal && probe["response"] ? String(probe["response"]) : null,
    })),
  };
}

function trimRubric(gate: Record<string, any> | undefined): RubricView {
  if (!gate) return { status: "skipped", percent: null, threshold: null, criteria: [] };
  const criteria = (gate["criteria"] ?? []) as Array<Record<string, any>>;
  return {
    status: (gate["status"] ?? "skipped") as RubricView["status"],
    percent: gate["percent"] === undefined ? null : Number(gate["percent"]),
    threshold: gate["threshold"] === undefined || gate["threshold"] === null
      ? null : Number(gate["threshold"]),
    criteria: criteria.map((criterion) => ({
      label: String(criterion["label"] ?? criterion["criterion_id"]),
      weight: Number(criterion["weight"] ?? 0),
      score: Number(criterion["score"] ?? 0),
      evidenceQuote: String(criterion["evidence_quote"] ?? ""),
      quoteGrounded: criterion["quote_grounded"] !== false,
    })),
  };
}

function trim(gate: Record<string, any> | undefined, reveal: boolean): GateView {
  if (!gate) return { ...EMPTY, cases: [] };
  return {
    status: (gate["status"] ?? "skipped") as GateView["status"],
    passed: Number(gate["passed"] ?? 0),
    total: Number(gate["total"] ?? 0),
    cases: reveal
      ? (gate["cases"] ?? []).map((c: Record<string, unknown>) => ({
          name: String(c["name"]),
          status: String(c["status"]),
          message: c["message"] === null || c["message"] === undefined ? null : String(c["message"]),
        }))
      : [],
  };
}
