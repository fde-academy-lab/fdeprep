/**
 * The evaluation panel. docs/10.
 *
 * Three evaluators run in a fixed order and their findings become one verdict,
 * one score and one voice. This file owns the ordering and the degradation;
 * `consolidate.ts` owns turning what ran into a result.
 *
 * The panelists are injected rather than imported. The panel's job is
 * orchestration, and a panel that reached for Bedrock itself could not be
 * tested on the outage path, which is the path it exists for.
 */
import {
  hasDeterministicScore, panelFor, type Complexity,
} from "../policy/complexity.ts";
import type { Band } from "../policy/bands.ts";
import { consolidate, type Evaluation } from "./consolidate.ts";

/**
 * `faculty` is a seat on the record, never a panelist the panel runs.
 * PANEL_ORDER below is the three automated ones, and a human is added to a
 * stored panel only by an override.
 */
export type PanelistName = "static" | "pretrained" | "llm" | "faculty";

/** The three the panel runs. A level's demand table is indexed by these. */
export type AutomatedPanelist = Exclude<PanelistName, "faculty">;

/** The order is the contract. P1 first, always. docs/10 section 1. */
export const PANEL_ORDER: readonly AutomatedPanelist[] = ["static", "pretrained", "llm"];

export type Severity = "blocking" | "informational";

export interface Finding {
  code: string;
  detail: string;
  severity: Severity;
}

export interface PanelistResult {
  status: "ran" | "unavailable" | "skipped";
  /** Why it could not run. Faculty see this; a learner never does. */
  reason?: string;
  ms: number;
  findings: Finding[];
  band?: Band;
  /**
   * Only the static panelist may set this. A band is an opinion and an opinion
   * cannot fail a submission, because a verdict nobody can reproduce is a
   * verdict nobody can appeal.
   */
  verdict?: "pass" | "fail";
  scoreContribution?: number;
}

export interface PanelInput {
  submissionId: number;
  complexity: Complexity;
  artefactType: string;
  body: string;
  problemSlug: string;
}

export interface Panelist {
  name: PanelistName;
  run(input: PanelInput): Promise<PanelistResult>;
}

export type { Evaluation } from "./consolidate.ts";

/**
 * Run the panel and consolidate what came back.
 *
 * A panelist the level does not ask for is skipped and never invoked. A
 * panelist that throws is treated as unavailable rather than fatal: an
 * evaluation that loses one voice is thinner, and an evaluation that loses all
 * of them because one crashed is a learner staring at nothing.
 */
export async function runPanel(
  input: PanelInput,
  panelists: readonly Panelist[],
): Promise<Evaluation> {
  const demand = panelFor(input.complexity);
  const byName = new Map(panelists.map((p) => [p.name, p]));
  const results: Array<PanelistResult & { panelist: PanelistName }> = [];

  for (const name of PANEL_ORDER) {
    const wanted = name === "static" ? "required" : demand[name];
    const panelist = byName.get(name);

    if (wanted === "no" || !panelist) {
      results.push({ panelist: name, status: "skipped", ms: 0, findings: [] });
      continue;
    }

    const started = Date.now();
    try {
      const result = await panelist.run(input);
      results.push({
        ...result,
        panelist: name,
        ms: result.ms || Date.now() - started,
        // A band from the static panelist would be a category error: it checks
        // facts. Dropped here rather than trusted, so a badly written panelist
        // cannot quietly start setting bands.
        band: name === "static" ? undefined : result.band,
        // And the reverse: only the static panelist may set a verdict.
        verdict: name === "static" ? result.verdict : undefined,
      });
    } catch (error) {
      results.push({
        panelist: name,
        status: "unavailable",
        reason: (error as Error).message.slice(0, 200),
        ms: Date.now() - started,
        findings: [],
      });
    }

    // Nothing after P1 is worth running when P1 could not run: the panel has
    // no verdict to consolidate and the evaluation is an error either way.
    if (name === "static" && results[0]!.status !== "ran") break;
  }

  return consolidate({
    submissionId: input.submissionId,
    complexity: input.complexity,
    deterministicScore: hasDeterministicScore(input.artefactType),
    demand,
    panel: results,
  });
}
