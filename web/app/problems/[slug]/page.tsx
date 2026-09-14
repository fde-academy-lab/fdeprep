/**
 * Screen S4, the code workspace.
 *
 * This component asks the policy module what to render and renders that. It
 * takes no view of its own on what a tier does, which is what keeps the four
 * tiers from drifting apart as the ladder changes.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db/pool";
import { resolvePolicy } from "@/lib/policy";
import { currentLearner } from "@/lib/session/current";
import Workspace from "./workspace";

export const dynamic = "force-dynamic";

export default async function WorkspacePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const learner = await currentLearner();

  const { rows } = await db().query<{
    id: string; title: string; track: string; tier: string;
    brief_md: string; contract_md: string | null; stub_code: string | null;
    steps: Array<{ id: string; text: string }>; call_budget: number | null;
    allowed_imports: string[]; reference_md: string | null;
  }>(
    `select p.id, p.title, p.track, p.difficulty::text as tier,
            v.brief_md, v.contract_md, v.stub_code, v.steps, v.call_budget,
            v.allowed_imports, v.reference_md
       from problem p
       join problem_version v on v.problem_id = p.id and v.version = p.current_version
      where p.slug = $1`, [slug]);

  const problem = rows[0];
  if (!problem) notFound();

  const policy = await resolvePolicy({
    enrolmentId: learner.enrolmentId, problemId: Number(problem.id),
  });

  return (
    <main className="flex h-screen flex-col">
      <header className="flex items-baseline justify-between border-b border-border px-4 py-2">
        <div className="flex items-baseline gap-3">
          <Link href="/problems" className="text-text-dim hover:text-accent">&lt; Problems</Link>
          <h1 className="font-semibold">{problem.title}</h1>
          <span className="capitalize text-text-dim">{problem.tier}</span>
          <span className="text-text-dim">{problem.track}</span>
        </div>
        <span className="tnum text-text-dim">
          {policy.submit.max === null
            ? "Submits today: unlimited"
            : `Submits left today: ${policy.submit.remaining}`}
        </span>
      </header>

      <Workspace
        problemId={Number(problem.id)}
        policy={policy}
        briefMd={problem.brief_md}
        // Each of these renders only if the policy says its layer is on. The
        // server withholds the content rather than hiding it in the client, so
        // a tier that should not show a stub does not ship one to the browser.
        contractMd={policy.layers.contract ? problem.contract_md : null}
        stubCode={policy.layers.stub ? (problem.stub_code ?? "") : ""}
        steps={policy.layers.steps ? (problem.steps ?? []) : []}
        referenceMd={policy.layers.reference ? problem.reference_md : null}
        callBudget={problem.call_budget}
        allowedImports={problem.allowed_imports ?? []}
      />
    </main>
  );
}
