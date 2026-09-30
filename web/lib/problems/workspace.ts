/**
 * Everything the workspace page renders, read in one place.
 *
 * What is deliberately absent: the probes (they live in source_yaml, which
 * only the judge worker reads), every test spec, and the coach's signals. The
 * coach ships its opening line and nothing else; the rest of its script stays
 * on the server and speaks through the coach route one nudge at a time.
 */
import { db } from "../db/pool.ts";
import type { Difficulty } from "../policy/tiers.ts";
import { trimSteps, type StepView } from "../submissions/view.ts";
import type { Approach, Build, Diagram, Kit, KitExample, KitTool, Scenario } from "./kit.ts";

export interface WorkspaceKit {
  scenario: Scenario | null;
  diagram: Diagram | null;
  approach: Approach | null;
  coachOpening: string | null;
  build: (Build & { stages: BuildStage[] }) | null;
  tools: KitTool[] | null;
  example: KitExample | null;
  /** Withheld by the page until the policy says the tier shows them. */
  traps: string[] | null;
}

export interface BuildStage {
  slug: string;
  title: string;
  stage: number;
  solved: boolean;
}

export interface WorkspaceProblem {
  id: number;
  slug: string;
  title: string;
  /** The day of a learner's first 30 as an FDE, or null for a problem published before it. */
  day: number | null;
  skill: string | null;
  /** How the problem comes up in an interview. */
  interview: { round: string; askedAs: string } | null;
  /** Wall clock per test case, in seconds. */
  timeLimitS: number;
  track: string;
  difficulty: Difficulty;
  artefact: "code" | "prompt" | "design";
  estMinutes: number;
  briefMd: string;
  contractMd: string | null;
  stubCode: string | null;
  steps: Array<{ id: string; text: string }>;
  callBudget: number | null;
  allowedImports: string[];
  referenceMd: string | null;
  originalPrompt: string | null;
  promptRules: Array<{ kind: string; label: string; pattern?: string; numeric_value?: number }>;
  wordRange: [number, number] | null;
  requiredHeadings: string[];
  rubric: Array<{ label: string; weight: number }>;
  probeCount: number;
  defenceQuestion: string | null;
  competencies: string[];
  kit: WorkspaceKit;
}

export interface PastSubmission {
  id: number;
  kind: string;
  verdict: string | null;
  score: number | null;
  queuedAt: string;
  publicPassed: number | null;
  publicTotal: number | null;
  hiddenPassed: number | null;
  hiddenTotal: number | null;
  llmCalls: number | null;
}

export interface AttemptHistory {
  note: string;
  hints: Array<{ ordinal: number; bodyMd: string }>;
  submissions: PastSubmission[];
  /** The checklist as the last finished run or submit left it. */
  steps: StepView[];
}

export async function loadWorkspaceProblem(
  slug: string, enrolmentId: number,
): Promise<WorkspaceProblem | null> {
  const { rows } = await db().query<Record<string, any>>(
    `select p.id, p.slug, p.title, p.day, p.skill, p.track, p.difficulty::text as difficulty,
            p.artefact_type::text as artefact, p.est_minutes,
            v.brief_md, v.contract_md, v.stub_code, v.steps, v.call_budget,
            v.allowed_imports, v.reference_md, v.original_prompt, v.prompt_rules,
            v.word_range, v.required_headings, v.rubric, v.probe_count,
            v.defence_question, v.kit, v.interview, v.time_limit_s,
            coalesce((select array_agg(c.slug order by pc.weight desc, c.slug)
                        from problem_competency pc join competency c on c.id = pc.competency_id
                       where pc.problem_id = p.id), '{}') as competencies
       from problem p
       join problem_version v on v.problem_id = p.id and v.version = p.current_version
      where p.slug = $1`, [slug]);
  const row = rows[0];
  if (!row) return null;

  const kit = (row["kit"] ?? {}) as Kit;
  return {
    id: Number(row["id"]),
    slug: row["slug"],
    title: row["title"],
    day: row["day"] === null || row["day"] === undefined ? null : Number(row["day"]),
    skill: row["skill"] ?? null,
    interview: row["interview"]
      ? { round: String(row["interview"].round), askedAs: String(row["interview"].asked_as) }
      : null,
    timeLimitS: Number(row["time_limit_s"] ?? 10),
    track: row["track"],
    difficulty: row["difficulty"],
    artefact: row["artefact"],
    estMinutes: Number(row["est_minutes"]),
    briefMd: row["brief_md"],
    contractMd: row["contract_md"],
    stubCode: row["stub_code"],
    steps: row["steps"] ?? [],
    callBudget: row["call_budget"],
    allowedImports: row["allowed_imports"] ?? [],
    referenceMd: row["reference_md"],
    originalPrompt: row["original_prompt"],
    promptRules: row["prompt_rules"] ?? [],
    wordRange: row["word_range"],
    requiredHeadings: row["required_headings"] ?? [],
    rubric: row["rubric"] ?? [],
    probeCount: Number(row["probe_count"] ?? 0),
    defenceQuestion: row["defence_question"],
    competencies: row["competencies"] ?? [],
    kit: {
      scenario: kit.scenario ?? null,
      diagram: kit.diagram ?? null,
      approach: kit.approach ?? null,
      coachOpening: kit.coach?.opening ?? null,
      build: kit.build ? { ...kit.build, stages: await buildStages(kit.build.id, enrolmentId) }
        : null,
      tools: kit.tools?.length ? kit.tools : null,
      example: kit.example ?? null,
      traps: kit.traps?.length ? kit.traps : null,
    },
  };
}

/** Every published stage of a build, in order, with whether this learner passed it. */
export async function buildStages(buildId: string, enrolmentId: number): Promise<BuildStage[]> {
  const { rows } = await db().query<{ slug: string; title: string; stage: number; solved: boolean }>(
    `select p.slug, p.title, (v.kit->'build'->>'stage')::int as stage,
            coalesce(a.solved_at is not null, false) as solved
       from problem p
       join problem_version v on v.problem_id = p.id and v.version = p.current_version
       left join attempt a on a.problem_id = p.id and a.enrolment_id = $2
      where v.kit->'build'->>'id' = $1
      order by stage`, [buildId, enrolmentId]);
  return rows.map((r) => ({ slug: r.slug, title: r.title, stage: r.stage, solved: r.solved }));
}

export async function attemptHistory(
  enrolmentId: number, problemId: number,
): Promise<AttemptHistory> {
  const attempt = await db().query<{ id: string; attempt_note: string | null }>(
    "select id, attempt_note from attempt where enrolment_id = $1 and problem_id = $2",
    [enrolmentId, problemId]);
  const row = attempt.rows[0];
  if (!row) return { note: "", hints: [], submissions: [], steps: [] };

  // Only hints from the version on screen. A hint revealed on an earlier
  // version stays on the record for faculty and is not the text this problem
  // now shows.
  const hints = await db().query<{ ordinal: number; body_md: string }>(
    `select h.ordinal, h.body_md
       from hint_reveal r
       join hint h on h.id = r.hint_id
       join problem_version v on v.id = h.problem_version_id
       join problem p on p.id = v.problem_id and p.current_version = v.version
      where r.attempt_id = $1
      order by h.ordinal`, [row.id]);

  const submissions = await db().query<Record<string, any>>(
    `select id, kind::text as kind, verdict::text as verdict, score, queued_at,
            public_passed, public_total, hidden_passed, hidden_total, llm_calls
       from submission where attempt_id = $1
      order by queued_at desc, id desc limit 20`, [row.id]);

  // The checklist shows what the last finished run said, and a run that never
  // reached the public tests says nothing about any step.
  const lastRun = await db().query<{ steps: unknown }>(
    `select result->'steps' as steps
       from submission
      where attempt_id = $1 and status = 'terminal' and kind in ('run', 'submit')
      order by queued_at desc, id desc limit 1`, [row.id]);

  return {
    note: row.attempt_note ?? "",
    steps: trimSteps(lastRun.rows[0]?.steps),
    hints: hints.rows.map((h) => ({ ordinal: h.ordinal, bodyMd: h.body_md })),
    submissions: submissions.rows.map((s) => ({
      id: Number(s["id"]),
      kind: s["kind"],
      verdict: s["verdict"],
      score: s["score"] === null ? null : Number(s["score"]),
      queuedAt: (s["queued_at"] as Date).toISOString(),
      publicPassed: s["public_passed"],
      publicTotal: s["public_total"],
      hiddenPassed: s["hidden_passed"],
      hiddenTotal: s["hidden_total"],
      llmCalls: s["llm_calls"],
    })),
  };
}

export interface Teaser { who: string; situation: string; diagram: Diagram | null }

/** The scenario's first lines, for a card that has to make a problem concrete in two lines. */
export async function teasers(slugs: string[]): Promise<Map<string, Teaser>> {
  if (!slugs.length) return new Map();
  const { rows } = await db().query<{
    slug: string; who: string | null; situation: string | null; diagram: Diagram | null;
  }>(
    `select p.slug, v.kit->'scenario'->>'who' as who, v.kit->'scenario'->>'situation' as situation,
            v.kit->'diagram' as diagram
       from problem p
       join problem_version v on v.problem_id = p.id and v.version = p.current_version
      where p.slug = any($1::text[])`, [slugs]);
  return new Map(rows.filter((r) => r.who && r.situation)
    .map((r) => [r.slug, { who: r.who!, situation: r.situation!, diagram: r.diagram }]));
}
