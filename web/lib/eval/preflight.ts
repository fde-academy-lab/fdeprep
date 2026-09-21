/**
 * The startup contract. docs/10 section 9.
 *
 * A worker asks its own catalogue which panelists the published problems
 * require, checks it can run them, and refuses to start when it cannot. The
 * alternative is what this replaces: a worker that boots happily, grades a
 * cohort's design answers on half a panel, and tells nobody.
 *
 * Nothing here is configured by hand. An operator setting a flag to describe
 * what their box is for would eventually set it wrong, so the content decides
 * and the worker reads it.
 *
 * Only absences are checked here, never outages. A model file that is not on
 * disk will still not be on disk in an hour, which is a fact worth knowing at
 * boot. Bedrock being unreachable is transient, costs a model call to test,
 * and is already handled at run time by the panel degrading to `partial` and
 * owing a free re-evaluation. Boot-time checks are for permanent facts.
 */
import type { Pool, PoolClient } from "pg";
import { parse } from "yaml";
import {
  defaultComplexity, isComplexity, panelFor, type Demand,
} from "../policy/complexity.ts";
import { embed } from "./embed.ts";
import type { PanelistName } from "./panel.ts";

export type ProbeResult = { ok: true } | { ok: false; reason: string };
export type Probe = () => Promise<ProbeResult>;

export interface PanelistCheck {
  panelist: PanelistName;
  /** The strongest demand any published problem places on this panelist. */
  demand: Demand;
  /** How many published problems require it, which is what an operator weighs. */
  requiredBy: number;
  ok: boolean;
  reason?: string;
  /** True when the operator named this panelist as one they are going without. */
  degraded: boolean;
}

export interface PreflightReport {
  ok: boolean;
  published: number;
  checks: PanelistCheck[];
  /** What the worker prints. One block, whether it starts or refuses. */
  message: string;
}

export interface PreflightOptions {
  /** Panelists the operator has accepted running without, from
   *  EVAL_DEGRADED_PANELISTS when not passed. */
  degraded?: PanelistName[];
}

/** Only the pretrained panelist has a cheap, honest boot probe. */
const PROBED: readonly PanelistName[] = ["pretrained"];

const FIXES: Readonly<Record<string, string>> = {
  pretrained: "python scripts/fetch_embedding_model.py",
};

export async function preflight(
  client: Pool | PoolClient,
  probes: Partial<Record<PanelistName, Probe>> = {},
  options: PreflightOptions = {},
): Promise<PreflightReport> {
  const declared = options.degraded ?? fromEnvironment();
  const degraded = declared.filter(isPanelistName);
  const unknown = declared.filter((name) => !isPanelistName(name));

  const { rows } = await client.query<{ artefact_type: string; source_yaml: string }>(
    `select p.artefact_type::text as artefact_type, v.source_yaml
       from problem p
       join problem_version v
         on v.problem_id = p.id and v.version = p.current_version
      where p.is_published`);

  const demands = rows.map((row) => {
    const level = (parse(row.source_yaml) as { complexity?: unknown } | null)?.complexity;
    const complexity = isComplexity(level) ? level : defaultComplexity(row.artefact_type);
    return panelFor(complexity);
  });

  const checks: PanelistCheck[] = [];
  for (const panelist of PROBED) {
    const wanted = demands.map((d) => d[panelist] as Demand);
    const demand = strongest(wanted);
    const requiredBy = wanted.filter((d) => d === "required").length;

    // A probe loads a model. Nothing in the catalogue needing this panelist
    // is a reason not to pay for it.
    if (demand === "no") {
      checks.push({ panelist, demand, requiredBy, ok: true, degraded: false });
      continue;
    }

    const probe = probes[panelist] ?? defaultProbe(panelist);
    const result = await probe();
    checks.push({
      panelist,
      demand,
      requiredBy,
      ok: result.ok,
      ...(result.ok ? {} : { reason: result.reason }),
      degraded: !result.ok && degraded.includes(panelist),
    });
  }

  // A panelist that is only optional may be absent without anybody deciding
  // anything: a code problem is graded by its tests, and the band would add
  // nothing the verdict did not already say.
  const blocking = checks.filter((c) => c.demand === "required" && !c.ok && !c.degraded);
  const ok = blocking.length === 0 && unknown.length === 0;

  return {
    ok,
    published: rows.length,
    checks,
    message: describe(checks, blocking, unknown, rows.length),
  };
}

function fromEnvironment(): string[] {
  return (process.env["EVAL_DEGRADED_PANELISTS"] ?? "")
    .split(",").map((name) => name.trim()).filter(Boolean);
}

function isPanelistName(value: string): value is PanelistName {
  return value === "static" || value === "pretrained" || value === "llm";
}

const ORDER: Readonly<Record<Demand, number>> = { no: 0, optional: 1, required: 2 };

/** The strongest demand any one problem places, since one is enough to bind. */
function strongest(demands: Demand[]): Demand {
  return demands.reduce<Demand>((worst, d) => (ORDER[d] > ORDER[worst] ? d : worst), "no");
}

function defaultProbe(panelist: PanelistName): Probe {
  if (panelist !== "pretrained") {
    return async () => ({ ok: false, reason: "no_probe" });
  }
  // A real encode of a real string. Checking that the files exist would miss
  // a host that has the weights and not the runtime, which is what CI looks
  // like and what a trimmed container image looks like.
  return async () => {
    const result = await embed(["a startup probe"]);
    return result.ok ? { ok: true } : { ok: false, reason: result.reason };
  };
}

/**
 * What the operator reads.
 *
 * Every line names an action or a number they need to choose between fixing
 * it and starting without it, per `.claude/rules/02-writing.md`.
 */
function describe(
  checks: PanelistCheck[],
  blocking: PanelistCheck[],
  unknown: string[],
  published: number,
): string {
  const lines: string[] = [];

  for (const name of unknown) {
    lines.push(`EVAL_DEGRADED_PANELISTS names "${name}", which is not a panelist. ` +
      "The panelists are static, pretrained and llm. Fix the spelling or remove it.");
  }

  for (const check of blocking) {
    lines.push(
      `The ${check.panelist} panelist cannot run here: ${check.reason}. ` +
      `${countOf(check.requiredBy, published)} require it, and grading them ` +
      "without it would quietly drop most of the evidence behind every band.");
    lines.push(`  Fix it:          ${FIXES[check.panelist] ?? "see docs/10 section 9"}`);
    lines.push(`  Or accept it:    EVAL_DEGRADED_PANELISTS=${check.panelist}`);
  }

  for (const check of checks.filter((c) => c.degraded)) {
    lines.push(
      `Starting without the ${check.panelist} panelist, which you asked for ` +
      `with EVAL_DEGRADED_PANELISTS. ${countOf(check.requiredBy, published)} ` +
      "ask for it, and their evaluations will carry medium confidence until it runs.");
  }

  for (const check of checks.filter((c) => c.demand === "optional" && !c.ok && !c.degraded)) {
    lines.push(
      `The ${check.panelist} panelist is not available here: ${check.reason}. ` +
      "No published problem requires it, so grading is unaffected.");
  }

  if (!lines.length) {
    const ready = checks.filter((c) => c.demand !== "no").map((c) => c.panelist);
    lines.push(ready.length
      ? `panel ready: ${ready.join(", ")} checked against ${published} published problems`
      : `panel ready: ${published} published problems need no probed panelist`);
  }

  return lines.join("\n");
}

function countOf(required: number, published: number): string {
  if (required === published) {
    return published === 1 ? "1 published problem" : `All ${published} published problems`;
  }
  return required === 1
    ? `1 of ${published} published problems`
    : `${required} of ${published} published problems`;
}
