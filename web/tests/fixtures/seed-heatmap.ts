/**
 * Drive the hand-computed fixture through the real scoring path.
 *
 * The submissions are written the way the pipeline writes them and then handed
 * to applyForSubmission, so the heatmap under test is produced by the same code
 * that runs in production rather than by a shortcut that agrees with it.
 */
import { db, inTransaction } from "../../lib/db/pool.ts";
import { applyForSubmission } from "../../lib/competency/score.ts";
import { SUBMISSIONS, type SeededSubmission } from "./heatmap.ts";

export async function seedHandComputedAccount(
  learner: { enrolmentId: number; cohortId: number },
  submissions: SeededSubmission[] = SUBMISSIONS,
): Promise<void> {
  for (const submission of submissions) {
    await seedOne(learner, submission);
  }
}

async function seedOne(
  learner: { enrolmentId: number; cohortId: number }, submission: SeededSubmission,
): Promise<void> {
  const { rows } = await db().query<{ id: string; version_id: string }>(
    `select p.id, v.id as version_id
       from problem p join problem_version v
         on v.problem_id = p.id and v.version = p.current_version
      where p.slug = $1`, [submission.slug]);
  const problem = rows[0];
  if (!problem) throw new Error(`the fixture names ${submission.slug}, which is not imported`);

  await inTransaction(async (client) => {
    const { rows: attemptRows } = await client.query<{ id: string }>(
      `insert into attempt (enrolment_id, problem_id, cohort_id, hints_used, submit_count)
       values ($1, $2, $3, $4, 1)
       on conflict (enrolment_id, problem_id) do update set
         hints_used = greatest(attempt.hints_used, excluded.hints_used),
         submit_count = attempt.submit_count + 1
       returning id`,
      [learner.enrolmentId, problem.id, learner.cohortId, submission.hintsUsed]);
    const attemptId = Number(attemptRows[0]!.id);

    const { rows: created } = await client.query<{ id: string }>(
      `insert into submission (attempt_id, problem_version_id, kind, body, body_sha256,
                               status, verdict, llm_calls, finished_at)
       values ($1, $2, 'submit', $3, $4, 'terminal', $5::verdict, $6, now())
       returning id`,
      [attemptId, problem.version_id, `# ${submission.slug} ${submission.hintsUsed}`,
       `sha-${submission.slug}-${submission.hintsUsed}-${submission.llmCalls}`,
       submission.verdict, submission.llmCalls]);

    if (submission.verdict === "pass") {
      await client.query(
        "update attempt set solved_at = coalesce(solved_at, now()) where id = $1", [attemptId]);
    }

    await applyForSubmission(client, Number(created[0]!.id));
  });
}
