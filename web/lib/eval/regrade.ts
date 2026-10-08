/**
 * Regrading earlier submissions under a new judge prompt. S15.3, call C5.
 *
 * `npm run regrade` (web/scripts/regrade.ts) drives this: it selects the
 * submissions whose newest evaluation a prompt other than the current one
 * graded, or the one prompt named, and appends a new evaluation for each
 * through reevaluate.ts. The rules a regrade keeps live there.
 *
 * What it selects, and why each condition is there:
 *
 * The newest evaluation only, because that is the one the learner's record
 * shows, and an older row was already replaced.
 *
 * Complete rows only. A partial row is owed a re-run by the drain, which
 * comes first, and an error row has no grade to move.
 *
 * No faculty override. A person settled that grade, and a regrade that
 * superseded it would undo the correction without anybody deciding to.
 *
 * Rows a judge prompt actually graded, read from panelist 3's seat. An answer
 * a cheaper check stopped was never in front of a model and is not moved.
 *
 * A row written before prompts were recorded names none, and counts as graded
 * under something other than the current prompt. That is true of every such
 * row once the first new prompt ships; until then a dry run shows them, and
 * running it regrades them under the same wording they had.
 *
 * This module reads the judge's own source to learn the current prompts, so
 * it reads its own path as it loads, and no page may import it.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Pool, PoolClient } from "pg";
import { db } from "../db/pool.ts";
import type { Band } from "../policy/bands.ts";
import type { Embed } from "./embed.ts";
import { regradeSubmission, type ReevaluationOutcome, type Rejudge } from "./reevaluate.ts";

const JUDGE = path.join(import.meta.dirname, "..", "..", "..", "judge");

export interface CurrentPrompts {
  /** What grades a design or prompt answer: RUBRIC_PROMPT in judge/rubric.py. */
  rubric: string;
  /** What grades a defence: DEFENCE_PROMPT in judge/defence.py. */
  defence: string;
}

/**
 * The prompts the judge in this checkout grades with.
 *
 * Read from the judge's own constants rather than restated here, so bumping
 * the prompt is one edit and the two cannot drift. A shape this cannot read
 * stops the command with the file named, rather than selecting against a
 * guess.
 */
export function currentJudgePrompts(judgeDir: string = JUDGE): CurrentPrompts {
  return {
    rubric: constant(judgeDir, "rubric.py", "RUBRIC_PROMPT"),
    defence: constant(judgeDir, "defence.py", "DEFENCE_PROMPT"),
  };
}

function constant(judgeDir: string, file: string, name: string): string {
  const source = readFileSync(path.join(judgeDir, file), "utf8");
  const match = new RegExp(`^${name}\\s*=\\s*"([^"]+)"\\s*$`, "m").exec(source);
  if (!match) {
    throw new Error(
      `judge/${file} no longer sets ${name} to a quoted file name, so the current judge ` +
      "prompt cannot be read. Update currentJudgePrompts in web/lib/eval/regrade.ts to match.");
  }
  const prompt = match[1]!;
  if (!existsSync(path.join(judgeDir, "prompts", prompt))) {
    throw new Error(`judge/${file} names ${prompt}, which is not in judge/prompts/.`);
  }
  return prompt;
}

/** The prompt that grades this kind of submission now. */
export function expectedPrompt(kind: string, current: CurrentPrompts): string {
  return kind === "defence" ? current.defence : current.rubric;
}

export interface RegradeCandidate {
  submissionId: number;
  evaluationId: number;
  kind: string;
  /** The prompt that graded it, or null for a row written before prompts were recorded. */
  judgePrompt: string | null;
  band: Band | null;
  login: string;
  slug: string;
  gradedAt: string;
}

export interface Selection {
  current: CurrentPrompts;
  /** Select the rows this prompt graded, in place of every row the current one did not. */
  from?: string;
  /** How many at most, oldest first. */
  limit: number;
}

export async function regradeCandidates(
  selection: Selection,
  client: Pool | PoolClient = db(),
): Promise<RegradeCandidate[]> {
  const params: unknown[] = [Math.max(1, Math.floor(selection.limit))];
  let prompt: string;
  if (selection.from) {
    params.push(selection.from);
    prompt = "e.judge_prompt = $2";
  } else {
    params.push(selection.current.defence, selection.current.rubric);
    prompt = `e.judge_prompt is distinct from
                (case when s.kind = 'defence' then $2 else $3 end)`;
  }

  const { rows } = await client.query<{
    evaluation_id: string; submission_id: string; judge_prompt: string | null;
    band: Band | null; created_at: Date; kind: string; login: string; slug: string;
  }>(
    `with newest as (
       select distinct on (submission_id) *
         from evaluation
        order by submission_id, created_at desc, id desc
     )
     select e.id as evaluation_id, e.submission_id, e.judge_prompt, e.band, e.created_at,
            s.kind::text as kind, u.github_login as login, p.slug
       from newest e
       join submission s      on s.id = e.submission_id
       join attempt a         on a.id = s.attempt_id
       join enrolment en      on en.id = a.enrolment_id
       join app_user u        on u.id = en.user_id
       join problem_version v on v.id = s.problem_version_id
       join problem p         on p.id = v.problem_id
      where e.state = 'complete'
        and e.overridden_by is null
        and s.verdict::text in ('pass', 'fail')
        and exists (select 1 from jsonb_array_elements(e.panel) seat
                     where seat->>'panelist' = 'llm' and seat->>'status' = 'ran')
        and ${prompt}
      order by e.created_at, e.id
      limit $1`, params);

  return rows.map((row) => ({
    submissionId: Number(row.submission_id),
    evaluationId: Number(row.evaluation_id),
    kind: row.kind,
    judgePrompt: row.judge_prompt,
    band: row.band,
    login: row.login,
    slug: row.slug,
    gradedAt: row.created_at.toISOString(),
  }));
}

export interface RegradeRun extends Selection {
  /** List the candidates, then stop: no judge call and no write. */
  dryRun: boolean;
  /** How to reach the judge. Needed unless this is a dry run. */
  rejudge?: Rejudge;
  embed?: Embed;
}

export interface RegradeReport {
  candidates: RegradeCandidate[];
  results: Array<{ candidate: RegradeCandidate; outcome: ReevaluationOutcome }>;
  /** Why the run stopped before its last candidate, or null when it did not. */
  stopped: string | null;
}

/**
 * Regrade one batch, oldest first, one submission at a time.
 *
 * One at a time because each is a model call and a batch is bounded by the
 * operator's limit rather than by how fast the judge answers. The run stops at
 * the first answer the judge grades with a prompt other than the current one:
 * that judge has not been deployed with the new prompt, and every further call
 * would be spent grading under the old wording again.
 */
export async function runRegrade(run: RegradeRun): Promise<RegradeReport> {
  const candidates = await regradeCandidates(run);
  const report: RegradeReport = { candidates, results: [], stopped: null };
  if (run.dryRun || !candidates.length) return report;
  if (!run.rejudge) {
    throw new Error("A regrade that is not a dry run needs a road to the judge.");
  }

  for (const candidate of candidates) {
    const outcome = await regradeSubmission(candidate, {
      rejudge: run.rejudge,
      embed: run.embed,
      // Named with --from, the operator asked for those rows whatever the judge
      // grades with now, which is how a regrade under unchanged wording is run.
      expect: run.from ? undefined : expectedPrompt(candidate.kind, run.current),
    });
    report.results.push({ candidate, outcome });
    if (outcome.status === "unchanged" && outcome.code === "prompt_mismatch") {
      report.stopped = outcome.reason;
      break;
    }
  }
  return report;
}
