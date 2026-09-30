/**
 * Screens S4, S5 and S6, chosen by the problem's artefact type.
 *
 * This component asks the policy module what to render and renders that. It
 * takes no view of its own on what a tier does, which is what keeps the four
 * tiers from drifting apart as the ladder changes.
 *
 * Withholding happens here, on the server: a layer the policy turns off is not
 * sent, so it cannot be read out of the page source. The probes never reach
 * this file at all (they live in source_yaml, which only the judge worker
 * reads), and the coach sends its opening line and nothing more.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/db/pool";
import { resolvePolicy } from "@/lib/policy";
import { currentLearner } from "@/lib/session/current";
import { paletteIndex } from "@/lib/problems/catalogue";
import { attemptHistory, loadWorkspaceProblem } from "@/lib/problems/workspace";
import { palettePages } from "@/components/shell/palette-pages";
import Workspace from "./workspace";
import PromptWorkspace from "./prompt-workspace";
import DesignWorkspace from "./design-workspace";
import { LockedStage } from "./locked-stage";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const { rows } = await db().query<{ title: string }>(
    "select title from problem where slug = $1", [slug]);
  return { title: rows[0]?.title ?? "Problem" };
}

export default async function WorkspacePage({ params, searchParams }: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const learner = await currentLearner();

  const loaded = await loadWorkspaceProblem(slug, learner.enrolmentId);
  if (!loaded) notFound();

  // A workspace opened from a rehearsal shell runs under screen conditions.
  // The id is checked against the learner's own sittings rather than trusted,
  // because otherwise anyone could add ?rehearsal=1 and change which rules apply.
  const rehearsalId = await activeRehearsal(query["rehearsal"], learner.enrolmentId);

  const policy = await resolvePolicy({
    enrolmentId: learner.enrolmentId, problemId: loaded.id, rehearsal: rehearsalId !== null,
  });

  if (policy.locked) return <LockedStage problem={loaded} lock={policy.locked} />;

  const problem = {
    ...loaded,
    contractMd: policy.layers.contract ? loaded.contractMd : null,
    stubCode: policy.layers.stub ? loaded.stubCode : "",
    steps: policy.layers.steps ? loaded.steps : [],
    referenceMd: policy.layers.reference ? loaded.referenceMd : null,
    kit: {
      ...loaded.kit,
      // The approach map and the coach are help, and screen conditions have none.
      approach: policy.coach.enabled ? loaded.kit.approach : null,
      coachOpening: policy.coach.enabled ? loaded.kit.coachOpening : null,
    },
  };
  const history = await attemptHistory(learner.enrolmentId, loaded.id);
  const shared = {
    problem, policy, history, rehearsalId,
    palette: await paletteIndex(learner.enrolmentId),
    pages: palettePages(learner.role),
  };

  return problem.artefact === "prompt" ? <PromptWorkspace {...shared} />
    : problem.artefact === "design" ? <DesignWorkspace {...shared} />
    : <Workspace {...shared} />;
}

/**
 * The rehearsal this workspace is inside, or null.
 *
 * Trusted only after it is matched to a sitting that belongs to this learner
 * and has not finished. The query string decides which screen the learner came
 * from; it does not get to decide which rules they are graded under.
 */
async function activeRehearsal(
  raw: string | string[] | undefined, enrolmentId: number,
): Promise<number | null> {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const id = Number(value);
  if (!value || !Number.isInteger(id)) return null;

  const { rows } = await db().query<{ id: string }>(
    `select id from rehearsal
      where id = $1 and enrolment_id = $2 and finished_at is null and ends_at > now()`,
    [id, enrolmentId]);
  return rows[0] ? Number(rows[0].id) : null;
}
