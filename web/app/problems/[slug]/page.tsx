/**
 * Screens S4, S5 and S6, chosen by the problem's artefact type.
 *
 * This component asks the policy module what to render and renders that. It
 * takes no view of its own on what a tier does, which is what keeps the four
 * tiers from drifting apart as the ladder changes.
 *
 * The probes are not read here and never reach this file. They live in
 * source_yaml, which only the judge worker reads, so the wording cannot leak
 * through a prop.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db/pool";
import { resolvePolicy } from "@/lib/policy";
import { currentLearner } from "@/lib/session/current";
import Workspace from "./workspace";
import PromptWorkspace from "./prompt-workspace";
import DesignWorkspace from "./design-workspace";

export const dynamic = "force-dynamic";

export default async function WorkspacePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const learner = await currentLearner();

  const { rows } = await db().query<{
    id: string; title: string; track: string; tier: string; artefact: string;
    brief_md: string; contract_md: string | null; stub_code: string | null;
    steps: Array<{ id: string; text: string }>; call_budget: number | null;
    allowed_imports: string[]; reference_md: string | null;
    original_prompt: string | null;
    prompt_rules: Array<{ kind: string; label: string; pattern?: string; numeric_value?: number }>;
    word_range: [number, number] | null;
    required_headings: string[];
    rubric: Array<{ label: string; weight: number }>;
    probe_count: number;
    defence_question: string | null;
  }>(
    `select p.id, p.title, p.track, p.difficulty::text as tier,
            p.artefact_type::text as artefact,
            v.brief_md, v.contract_md, v.stub_code, v.steps, v.call_budget,
            v.allowed_imports, v.reference_md,
            v.original_prompt, v.prompt_rules, v.word_range, v.required_headings, v.rubric,
            -- A count, never the probes. They live in source_yaml, which only
            -- the judge worker reads, so no prop can carry their wording.
            v.probe_count, v.defence_question
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

      {problem.artefact === "prompt" ? (
        <PromptWorkspace
          problemId={Number(problem.id)}
          policy={policy}
          briefMd={problem.brief_md}
          originalPrompt={problem.original_prompt ?? ""}
          promptRules={problem.prompt_rules as never}
          probeCount={Number(problem.probe_count)}
          referenceMd={policy.layers.reference ? problem.reference_md : null}
        />
      ) : problem.artefact === "design" ? (
        <DesignWorkspace
          problemId={Number(problem.id)}
          policy={policy}
          briefMd={problem.brief_md}
          wordRange={problem.word_range}
          requiredHeadings={problem.required_headings ?? []}
          rubric={problem.rubric ?? []}
          referenceMd={policy.layers.reference ? problem.reference_md : null}
        />
      ) : (
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
        // docs/03 section 4.4: the defence renders only once the battery
        // passes, which the policy decides rather than this component.
        defenceQuestion={problem.defence_question}
      />
      )}
    </main>
  );
}
