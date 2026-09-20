/**
 * Three panelists in, one verdict out. docs/10 section 7.
 *
 * Pure. No database, no clock, no network, so the rules that decide a learner's
 * grade can be read in one file and tested without a fixture.
 */
import {
  bandDistance, bandScore, DISAGREEMENT_STEPS, lowerBand, type Band,
} from "../policy/bands.ts";
import type { Complexity, PanelDemand } from "../policy/complexity.ts";
import type { PanelistName, PanelistResult } from "./panel.ts";

export type EvaluationState = "complete" | "partial" | "error";
export type Confidence = "high" | "medium" | "low";

export interface Disagreement {
  bands: Band[];
  /** The more cautious one. Never the mean. */
  held: Band;
}

export interface Evaluation {
  submissionId: number;
  complexity: Complexity;
  state: EvaluationState;
  verdict: "pass" | "fail" | null;
  score: number | null;
  scoreProvisional: boolean;
  confidence: Confidence;
  band: Band | null;
  panel: Array<PanelistResult & { panelist: PanelistName }>;
  disagreement: Disagreement | null;
  /** The one voice. Carries no panelist name. */
  feedbackMd: string;
}

export interface ConsolidateInput {
  submissionId: number;
  complexity: Complexity;
  deterministicScore: boolean;
  demand: PanelDemand;
  panel: Array<PanelistResult & { panelist: PanelistName }>;
}

export function consolidate(input: ConsolidateInput): Evaluation {
  const { panel } = input;
  const statik = panel.find((p) => p.panelist === "static");
  const base: Omit<Evaluation, "state" | "verdict" | "score" | "scoreProvisional"
                            | "confidence" | "band" | "disagreement" | "feedbackMd"> = {
    submissionId: input.submissionId,
    complexity: input.complexity,
    panel,
  };

  // docs/10 section 9: P1 unavailable is an error verdict, and an error
  // consumes nothing. Nothing else in the panel can substitute for it.
  if (!statik || statik.status !== "ran") {
    return {
      ...base,
      state: "error",
      verdict: null,
      score: null,
      scoreProvisional: false,
      confidence: "low",
      band: null,
      disagreement: null,
      feedbackMd:
        "Grading did not complete. Your attempt was not counted. Try again.",
    };
  }

  const bands = panel
    .filter((p) => p.status === "ran" && p.band !== undefined)
    .map((p) => p.band!);

  const disagreement = findDisagreement(bands);
  const band = bands.length
    ? (disagreement ? disagreement.held : bands.reduce(lowerBand))
    : null;

  // A panelist the level demanded and did not get leaves the evaluation
  // unfinished, and the platform owes a free re-run.
  const missing = panel.filter((p) =>
    p.status === "unavailable" && demandFor(input.demand, p.panelist) !== "no");
  const state: EvaluationState = missing.length ? "partial" : "complete";

  const verdict = statik.verdict ?? null;
  const score = input.deterministicScore || band === null
    ? statik.scoreContribution ?? null
    : bandScore(band);

  return {
    ...base,
    state,
    verdict,
    score,
    scoreProvisional: state === "partial",
    confidence: confidenceFor(state, disagreement),
    band,
    disagreement,
    feedbackMd: feedback(panel, state, verdict),
  };
}

function demandFor(demand: PanelDemand, name: PanelistName): string {
  return name === "static" ? "required" : demand[name];
}

function findDisagreement(bands: Band[]): Disagreement | null {
  if (bands.length < 2) return null;
  let worst: [Band, Band] | null = null;
  let distance = 0;
  for (let i = 0; i < bands.length; i += 1) {
    for (let j = i + 1; j < bands.length; j += 1) {
      const d = bandDistance(bands[i]!, bands[j]!);
      if (d > distance) {
        distance = d;
        worst = [bands[i]!, bands[j]!];
      }
    }
  }
  if (!worst || distance < DISAGREEMENT_STEPS) return null;
  // Averaging two judges who disagree produces a confident number that hides
  // the one fact worth knowing, which is that this answer is hard to grade.
  return { bands: worst, held: lowerBand(worst[0], worst[1]) };
}

function confidenceFor(state: EvaluationState, disagreement: Disagreement | null): Confidence {
  if (disagreement) return "low";
  return state === "complete" ? "high" : "medium";
}

/**
 * The one voice.
 *
 * Blocking findings first, because they are why the submission failed.
 * Informational findings after. No panelist is named, and no reason a panelist
 * gave for being unavailable reaches this string: docs/10 section 7 keeps
 * provenance on the record and out of the learner's reading.
 */
function feedback(
  panel: Array<PanelistResult & { panelist: PanelistName }>,
  state: EvaluationState,
  verdict: "pass" | "fail" | null,
): string {
  const findings = panel.filter((p) => p.status === "ran").flatMap((p) => p.findings);
  const lines: string[] = [];

  for (const f of findings.filter((f) => f.severity === "blocking")) {
    lines.push(`- ${f.detail}`);
  }
  for (const f of findings.filter((f) => f.severity === "informational")) {
    lines.push(`- ${f.detail}`);
  }

  if (!lines.length) {
    lines.push(verdict === "pass"
      ? "- Every check this answer was measured against passed."
      : "- This answer did not meet the acceptance condition in the brief.");
  }

  if (state === "partial") {
    // The message names the next action, per .claude/rules/02-writing.md, and
    // says plainly that the learner is not being charged for the gap.
    lines.push("");
    lines.push("The detailed review is still running and will appear here within " +
      "the hour. Your attempt has been counted once, and the score above may rise " +
      "when the review lands.");
  }

  return lines.join("\n");
}
