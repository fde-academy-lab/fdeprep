/** Screen S4, the code workspace. */
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db/pool";
import { policyFor, hintButtonLabel, type Difficulty } from "@/lib/policy/difficulty";
import { currentLearner } from "@/lib/session/current";
import Workspace from "./workspace";

export const dynamic = "force-dynamic";

export default async function WorkspacePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const learner = await currentLearner();

  const { rows } = await db().query<{
    id: string; title: string; difficulty: Difficulty; track: string;
    brief_md: string; contract_md: string | null; stub_code: string | null;
    steps: Array<{ id: string; text: string }>; call_budget: number | null;
    allowed_imports: string[]; hints: number; failed_runs: number;
    attempt_note: string | null; submits_left: number;
  }>(
    `select p.id, p.title, p.difficulty::text as difficulty, p.track,
            v.brief_md, v.contract_md, v.stub_code, v.steps, v.call_budget, v.allowed_imports,
            (select count(*) from hint h where h.problem_version_id = v.id)::int as hints,
            coalesce((select count(*) from submission s join attempt a2 on a2.id = s.attempt_id
                       where a2.enrolment_id = $2 and a2.problem_id = p.id
                         and s.verdict is not null and s.verdict <> 'pass'), 0)::int as failed_runs,
            a.attempt_note,
            greatest(0, coalesce(pol.max_count, 0) - coalesce(c.count, 0))::int as submits_left
       from problem p
       join problem_version v on v.problem_id = p.id and v.version = p.current_version
       left join attempt a on a.problem_id = p.id and a.enrolment_id = $2
       left join rate_limit_policy pol
              on pol.scope = 'submit_daily' and pol.difficulty = p.difficulty
       left join rate_limit_counter c
              on c.enrolment_id = $2 and c.scope = 'submit_daily' and c.problem_id = p.id
             and c.window_start > now() - interval '1 day'
      where p.slug = $1`, [slug, learner.enrolmentId]);

  const problem = rows[0];
  if (!problem) notFound();

  // Every question about what this tier renders is answered by the policy
  // module. No component reads difficulty to decide for itself.
  const policy = policyFor(problem.difficulty);

  return (
    <main className="flex h-screen flex-col">
      <header className="flex items-baseline justify-between border-b border-border px-4 py-2">
        <div className="flex items-baseline gap-3">
          <Link href="/problems" className="text-text-dim hover:text-accent">&lt; Problems</Link>
          <h1 className="font-semibold">{problem.title}</h1>
          <span className="capitalize text-text-dim">{problem.difficulty}</span>
          <span className="text-text-dim">{problem.track}</span>
        </div>
        <span className="tnum text-text-dim">Submits left today: {problem.submits_left}</span>
      </header>

      <Workspace
        problemId={Number(problem.id)}
        title={problem.title}
        briefMd={problem.brief_md}
        contractMd={policy.showsContract ? problem.contract_md : null}
        stubCode={policy.showsStub ? (problem.stub_code ?? "") : ""}
        steps={policy.showsSteps ? (problem.steps ?? []) : []}
        callBudget={problem.call_budget}
        allowedImports={problem.allowed_imports ?? []}
        hintCount={problem.hints}
        hintLabel={hintButtonLabel(
          problem.difficulty, problem.failed_runs, problem.attempt_note?.length ?? 0)}
        showsHiddenCount={policy.showsHiddenCount}
        confirmBeforeSubmit={policy.confirmBeforeSubmit}
      />
    </main>
  );
}
