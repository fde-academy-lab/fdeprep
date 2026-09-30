/**
 * The problem kit. docs/04 section 2.
 *
 * A brief says what is wrong. The kit is what lets a learner picture it and get
 * unstuck on it: a scenario card with the people and the numbers, a system
 * diagram of where the failure lives, an approach map of how to think about
 * it, a coach script that reacts to what the learner actually does, and a
 * hint ladder that narrows without handing over the answer.
 *
 * Every limit below exists because the renderer has a box of a fixed size and
 * a label that overflows it reads as broken. The validator enforces them in CI
 * so the failure is an author's, caught at review, rather than a learner's.
 */

import { compilePattern } from "../gate/rules.ts";

/**
 * A coach pattern: the same dialect as prompt rules and probes, so an author
 * writes (?i) once and it means the same thing everywhere in the file, plus
 * multiline, so ^ anchors at the start of a line of the learner's code.
 */
export function coachPattern(source: string): RegExp {
  const re = compilePattern(source);
  return re.flags.includes("m") ? re : new RegExp(re.source, re.flags + "m");
}

/** What a diagram node is, which decides its icon and outline. */
export const NODE_KINDS = [
  "actor", "model", "agent", "tool", "store", "service", "decision",
  "output", "doc", "queue", "guard",
] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

/** One hue per subject, from the explainer grammar. */
export const TONES = ["blue", "green", "purple", "teal", "orange", "pink", "neutral"] as const;
export type Tone = (typeof TONES)[number];

export const EDGE_TONES = ["default", "danger", "success", "muted"] as const;
export type EdgeTone = (typeof EDGE_TONES)[number];

export const KIT_LIMITS = {
  scenarioWho: 80,
  scenarioSituation: 320,
  scenarioStakes: 200,
  metrics: 3,
  metricLabel: 28,
  metricValue: 16,
  diagramTitle: 72,
  diagramCaption: 160,
  nodesMin: 2,
  nodesMax: 10,
  edgesMin: 1,
  edgesMax: 14,
  nodeLabel: 26,
  nodeSub: 44,
  edgeLabel: 30,
  approachGoal: 90,
  branchesMin: 2,
  branchesMax: 5,
  branchLabel: 48,
  branchDetail: 140,
  leavesMax: 4,
  leaf: 64,
  coachOpening: 240,
  coachSay: 280,
  signalsMax: 12,
  hintsMin: 3,
  hintsMax: 5,
  hint: 320,
  buildTitle: 80,
} as const;

export interface Scenario {
  who: string;
  situation: string;
  stakes: string;
  metrics: Array<{ label: string; value: string }>;
}

export interface DiagramNode {
  id: string;
  label: string;
  sub?: string;
  kind: NodeKind;
  tone: Tone;
  /** An explicit [column, row] on the layout grid, when the author wants one. */
  at?: [number, number];
}

export interface DiagramEdge {
  from: string;
  to: string;
  label?: string;
  tone: EdgeTone;
  /** A numbered circle on the edge, for when order matters. */
  step?: number;
}

export interface Diagram {
  title: string;
  caption?: string;
  direction: "lr" | "tb";
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

export interface Approach {
  goal: string;
  branches: Array<{ label: string; detail?: string; leaves: string[] }>;
}

/**
 * What makes a coach signal fire. Every condition present must hold.
 *
 * Deterministic on purpose. CLAUDE.md: learner code never reaches a model
 * endpoint, so the coach reads the code with patterns and reads runs by the
 * names of the tests that failed, and says what an author wrote.
 */
export interface SignalWhen {
  code_matches?: string;
  code_lacks?: string;
  test_failed?: string;
  idle_minutes?: number;
  runs_at_least?: number;
  failed_runs_at_least?: number;
}

export interface CoachSignal {
  id: string;
  when: SignalWhen;
  say: string;
}

export interface Coach {
  opening: string;
  signals: CoachSignal[];
  /** Said once, after a pass: the production lesson the problem was for. */
  wrap_up?: string;
}

export interface Build {
  id: string;
  title: string;
  stage: number;
  of: number;
}

export interface Kit {
  scenario?: Scenario;
  diagram?: Diagram;
  approach?: Approach;
  coach?: Coach;
  build?: Build;
}

type Add = (rule: KitRule, message: string, line: number) => void;
type LineOf = (path: Array<string | number>) => number;

export type KitRule =
  | "kit_missing" | "kit_scenario" | "kit_diagram" | "kit_approach" | "kit_coach"
  | "kit_build" | "hint_count" | "missing_stub" | "stub_signature";

export interface KitContext {
  artefact: string;
  requireKit: boolean;
  /** Test and probe names a coach signal may key off. */
  runNames: Set<string>;
  hints: unknown[];
  add: Add;
  lineOf: LineOf;
}

const SLUG = /^[a-z0-9][a-z0-9_-]*$/;
const SIGNAL_KEYS = new Set<keyof SignalWhen>([
  "code_matches", "code_lacks", "test_failed", "idle_minutes", "runs_at_least",
  "failed_runs_at_least",
]);

/** The entry point every code problem's contract names. */
export const ENTRY_POINT = /\bdef\s+run_agent\s*\(/;

export function validateKit(raw: Record<string, unknown>, ctx: KitContext): Kit {
  const { add, lineOf } = ctx;
  const kit: Kit = {};

  if (ctx.requireKit) {
    const missing = (["scenario", "diagram", "approach", "coach"] as const)
      .filter((key) => raw[key] === undefined || raw[key] === null);
    for (const key of missing) {
      add("kit_missing",
          `${key} is missing. Every catalogue problem carries a scenario, a diagram, an ` +
          "approach map and a coach script, because a brief alone is text a learner has " +
          "to picture unaided", 1);
    }
    const hints = ctx.hints.length;
    if (hints < KIT_LIMITS.hintsMin || hints > KIT_LIMITS.hintsMax) {
      add("hint_count",
          `found ${hints} hints. The ladder has ${KIT_LIMITS.hintsMin} to ` +
          `${KIT_LIMITS.hintsMax} rungs: where to look, the mechanism, the shape of the fix, ` +
          "then an outline, and none of them the answer",
          hints ? lineOf(["hints", 0]) : 1);
    }
    if (ctx.artefact === "code") {
      const stub = raw["stub_code"];
      if (typeof stub !== "string" || !stub.trim()) {
        add("missing_stub",
            "a code problem needs stub_code at every tier. Depth varies with difficulty: a " +
            "full scaffold on Easy, the signature and its contract on Extreme", 1);
      } else if (!ENTRY_POINT.test(stub)) {
        add("stub_signature",
            "stub_code does not define run_agent(...), which is the entry point the contract " +
            "names and the runner calls", lineOf(["stub_code"]));
      }
    }
  }
  ctx.hints.forEach((hint, index) => {
    if (typeof hint === "string" && hint.length > KIT_LIMITS.hint) {
      add("hint_count", `hint ${index + 1} runs to ${hint.length} characters; keep a rung under ` +
          `${KIT_LIMITS.hint} so it reads as a nudge`, lineOf(["hints", index]));
    }
  });

  if (raw["scenario"] !== undefined) kit.scenario = validateScenario(raw["scenario"], add, lineOf);
  if (raw["diagram"] !== undefined) kit.diagram = validateDiagram(raw["diagram"], add, lineOf);
  if (raw["approach"] !== undefined) kit.approach = validateApproach(raw["approach"], add, lineOf);
  if (raw["coach"] !== undefined) {
    kit.coach = validateCoach(raw["coach"], ctx.runNames, add, lineOf);
  }
  if (raw["build"] !== undefined) kit.build = validateBuild(raw["build"], add, lineOf);
  return kit;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Rejects keys the renderer does not know. An unquoted comma inside a flow
 * mapping splits the value, so { sub: fix, rerun } is sub "fix" plus an empty
 * key "rerun", and the unknown key is the only trace the split leaves.
 */
function onlyKeys(
  value: Record<string, unknown>, allowed: readonly string[], where: string, rule: KitRule,
  add: Add, line: number,
): void {
  for (const key of Object.keys(value)) {
    if (allowed.includes(key)) continue;
    add(rule, `${where} has an unknown key "${key}". Known keys: ${allowed.join(", ")}. If a ` +
        "value holds a comma, a colon or a question mark, quote it, because an unquoted one " +
        "splits the value", line);
  }
}

function within(
  value: unknown, limit: number, field: string, rule: KitRule, add: Add, line: number,
  required = true,
): string {
  const s = text(value);
  if (!s) {
    if (required) add(rule, `${field} is empty`, line);
    return "";
  }
  if (s.length > limit) {
    add(rule, `${field} runs to ${s.length} characters and the box holds ${limit}`, line);
  }
  return s;
}

function validateScenario(value: unknown, add: Add, lineOf: LineOf): Scenario | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    add("kit_scenario", "scenario must be a mapping of who, situation and stakes",
        lineOf(["scenario"]));
    return undefined;
  }
  const s = value as Record<string, unknown>;
  const L = KIT_LIMITS;
  onlyKeys(s, ["who", "situation", "stakes", "metrics"], "scenario", "kit_scenario", add,
    lineOf(["scenario"]));
  const who = within(s["who"], L.scenarioWho, "scenario.who", "kit_scenario", add,
    lineOf(["scenario", "who"]));
  const situation = within(s["situation"], L.scenarioSituation, "scenario.situation",
    "kit_scenario", add, lineOf(["scenario", "situation"]));
  const stakes = within(s["stakes"], L.scenarioStakes, "scenario.stakes", "kit_scenario", add,
    lineOf(["scenario", "stakes"]));
  const rawMetrics = Array.isArray(s["metrics"]) ? (s["metrics"] as unknown[]) : [];
  if (rawMetrics.length > L.metrics) {
    add("kit_scenario", `scenario carries ${rawMetrics.length} metrics and the card shows ` +
        `${L.metrics}`, lineOf(["scenario", "metrics"]));
  }
  const metrics = rawMetrics.map((m, index) => {
    const entry = (m ?? {}) as Record<string, unknown>;
    const line = lineOf(["scenario", "metrics", index]);
    onlyKeys(entry, ["label", "value"], `metric ${index + 1}`, "kit_scenario", add, line);
    return {
      label: within(entry["label"], L.metricLabel, `metric ${index + 1} label`,
        "kit_scenario", add, line),
      value: within(entry["value"] === undefined ? "" : String(entry["value"]), L.metricValue,
        `metric ${index + 1} value`, "kit_scenario", add, line),
    };
  });
  return { who, situation, stakes, metrics };
}

function validateDiagram(value: unknown, add: Add, lineOf: LineOf): Diagram | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    add("kit_diagram", "diagram must be a mapping with a title, nodes and edges",
        lineOf(["diagram"]));
    return undefined;
  }
  const d = value as Record<string, unknown>;
  const L = KIT_LIMITS;
  onlyKeys(d, ["title", "caption", "direction", "nodes", "edges"], "diagram", "kit_diagram", add,
    lineOf(["diagram"]));
  const title = within(d["title"], L.diagramTitle, "diagram.title", "kit_diagram", add,
    lineOf(["diagram", "title"]));
  const caption = within(d["caption"], L.diagramCaption, "diagram.caption", "kit_diagram", add,
    lineOf(["diagram", "caption"]), false) || undefined;
  const direction = d["direction"] === "tb" ? "tb" : "lr";
  if (d["direction"] !== undefined && d["direction"] !== "lr" && d["direction"] !== "tb") {
    add("kit_diagram", `diagram.direction ${String(d["direction"])} is not lr or tb`,
        lineOf(["diagram", "direction"]));
  }

  const rawNodes = Array.isArray(d["nodes"]) ? (d["nodes"] as unknown[]) : [];
  if (rawNodes.length < L.nodesMin || rawNodes.length > L.nodesMax) {
    add("kit_diagram",
        `the diagram has ${rawNodes.length} nodes. It needs ${L.nodesMin} to ${L.nodesMax}, ` +
        "because a picture with more is one nobody takes in at a glance",
        lineOf(["diagram", "nodes"]));
  }
  const ids = new Set<string>();
  const nodes: DiagramNode[] = rawNodes.map((n, index) => {
    const node = (n ?? {}) as Record<string, unknown>;
    const line = lineOf(["diagram", "nodes", index]);
    const id = text(node["id"]);
    if (!SLUG.test(id)) add("kit_diagram", `node ${index + 1} needs a slug id, found "${id}"`, line);
    onlyKeys(node, ["id", "label", "sub", "kind", "tone", "at"], `node ${id}`, "kit_diagram", add,
      line);
    if (ids.has(id)) add("kit_diagram", `node id ${id} is used twice`, line);
    ids.add(id);
    const kind = (node["kind"] ?? "service") as NodeKind;
    if (!NODE_KINDS.includes(kind)) {
      add("kit_diagram", `node ${id} has kind ${String(kind)}, which the renderer cannot draw. ` +
          `Known kinds: ${NODE_KINDS.join(", ")}`, line);
    }
    const tone = (node["tone"] ?? "neutral") as Tone;
    if (!TONES.includes(tone)) {
      add("kit_diagram", `node ${id} has tone ${String(tone)}. Known tones: ${TONES.join(", ")}`,
          line);
    }
    let at: [number, number] | undefined;
    if (node["at"] !== undefined) {
      const pair = node["at"] as unknown[];
      if (!Array.isArray(pair) || pair.length !== 2 || !pair.every((v) => Number.isInteger(v))) {
        add("kit_diagram", `node ${id} has at ${JSON.stringify(node["at"])}; it must be ` +
            "[column, row] as two whole numbers", line);
      } else {
        at = [pair[0] as number, pair[1] as number];
      }
    }
    const sub = within(node["sub"], L.nodeSub, `node ${id} sub`, "kit_diagram", add, line, false);
    return {
      id,
      label: within(node["label"], L.nodeLabel, `node ${id} label`, "kit_diagram", add, line),
      ...(sub ? { sub } : {}),
      kind: NODE_KINDS.includes(kind) ? kind : "service",
      tone: TONES.includes(tone) ? tone : "neutral",
      ...(at ? { at } : {}),
    };
  });

  const rawEdges = Array.isArray(d["edges"]) ? (d["edges"] as unknown[]) : [];
  if (rawEdges.length < L.edgesMin || rawEdges.length > L.edgesMax) {
    add("kit_diagram", `the diagram has ${rawEdges.length} edges; it needs ${L.edgesMin} to ` +
        `${L.edgesMax}`, lineOf(["diagram", "edges"]));
  }
  const edges: DiagramEdge[] = rawEdges.map((e, index) => {
    const edge = (e ?? {}) as Record<string, unknown>;
    const line = lineOf(["diagram", "edges", index]);
    const from = text(edge["from"]);
    const to = text(edge["to"]);
    onlyKeys(edge, ["from", "to", "label", "tone", "step"], `edge ${index + 1}`, "kit_diagram",
      add, line);
    for (const [end, name] of [["from", from], ["to", to]] as const) {
      if (!ids.has(name)) {
        add("kit_diagram", `edge ${index + 1} goes ${end} "${name}", which is not a node. ` +
            `Nodes: ${[...ids].join(", ")}`, line);
      }
    }
    const tone = (edge["tone"] ?? "default") as EdgeTone;
    if (!EDGE_TONES.includes(tone)) {
      add("kit_diagram", `edge ${index + 1} has tone ${String(tone)}. Known: ` +
          `${EDGE_TONES.join(", ")}`, line);
    }
    const step = edge["step"];
    if (step !== undefined && (!Number.isInteger(step) || (step as number) < 1)) {
      add("kit_diagram", `edge ${index + 1} has step ${String(step)}; steps are 1, 2, 3...`, line);
    }
    const label = within(edge["label"], L.edgeLabel, `edge ${index + 1} label`, "kit_diagram",
      add, line, false);
    return {
      from, to,
      ...(label ? { label } : {}),
      tone: EDGE_TONES.includes(tone) ? tone : "default",
      ...(Number.isInteger(step) ? { step: step as number } : {}),
    };
  });

  return { title, ...(caption ? { caption } : {}), direction, nodes, edges };
}

function validateApproach(value: unknown, add: Add, lineOf: LineOf): Approach | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    add("kit_approach", "approach must be a mapping of a goal and its branches",
        lineOf(["approach"]));
    return undefined;
  }
  const a = value as Record<string, unknown>;
  const L = KIT_LIMITS;
  onlyKeys(a, ["goal", "branches"], "approach", "kit_approach", add, lineOf(["approach"]));
  const goal = within(a["goal"], L.approachGoal, "approach.goal", "kit_approach", add,
    lineOf(["approach", "goal"]));
  const rawBranches = Array.isArray(a["branches"]) ? (a["branches"] as unknown[]) : [];
  if (rawBranches.length < L.branchesMin || rawBranches.length > L.branchesMax) {
    add("kit_approach", `the approach map has ${rawBranches.length} branches; it needs ` +
        `${L.branchesMin} to ${L.branchesMax}, since one branch is a sentence and six is a list`,
        lineOf(["approach", "branches"]));
  }
  const branches = rawBranches.map((b, index) => {
    const branch = (b ?? {}) as Record<string, unknown>;
    const line = lineOf(["approach", "branches", index]);
    onlyKeys(branch, ["label", "detail", "leaves"], `branch ${index + 1}`, "kit_approach", add,
      line);
    const leaves = Array.isArray(branch["leaves"]) ? (branch["leaves"] as unknown[]) : [];
    leaves.forEach((leaf, j) => {
      if (typeof leaf !== "string") {
        add("kit_approach", `branch ${index + 1} leaf ${j + 1} is not text. A colon inside a ` +
            "leaf turns it into a mapping; quote the leaf", line);
      }
    });
    if (leaves.length > L.leavesMax) {
      add("kit_approach", `branch ${index + 1} has ${leaves.length} leaves; keep it to ` +
          `${L.leavesMax}`, line);
    }
    const detail = within(branch["detail"], L.branchDetail, `branch ${index + 1} detail`,
      "kit_approach", add, line, false);
    return {
      label: within(branch["label"], L.branchLabel, `branch ${index + 1} label`, "kit_approach",
        add, line),
      ...(detail ? { detail } : {}),
      leaves: leaves.map((leaf, j) =>
        within(leaf, L.leaf, `branch ${index + 1} leaf ${j + 1}`, "kit_approach", add, line)),
    };
  });
  return { goal, branches };
}

function validateCoach(
  value: unknown, runNames: Set<string>, add: Add, lineOf: LineOf,
): Coach | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    add("kit_coach", "coach must be a mapping with an opening and signals", lineOf(["coach"]));
    return undefined;
  }
  const c = value as Record<string, unknown>;
  const L = KIT_LIMITS;
  onlyKeys(c, ["opening", "signals", "wrap_up"], "coach", "kit_coach", add, lineOf(["coach"]));
  const opening = within(c["opening"], L.coachOpening, "coach.opening", "kit_coach", add,
    lineOf(["coach", "opening"]));
  const wrapUp = within(c["wrap_up"], L.coachSay, "coach.wrap_up", "kit_coach", add,
    lineOf(["coach", "wrap_up"]), false);
  const rawSignals = Array.isArray(c["signals"]) ? (c["signals"] as unknown[]) : [];
  if (rawSignals.length > L.signalsMax) {
    add("kit_coach", `the coach has ${rawSignals.length} signals; keep it to ${L.signalsMax}, ` +
        "since a coach that says everything says nothing", lineOf(["coach", "signals"]));
  }
  const seen = new Set<string>();
  const signals: CoachSignal[] = rawSignals.map((s, index) => {
    const signal = (s ?? {}) as Record<string, unknown>;
    const line = lineOf(["coach", "signals", index]);
    const id = text(signal["id"]);
    if (!SLUG.test(id)) add("kit_coach", `signal ${index + 1} needs a slug id`, line);
    onlyKeys(signal, ["id", "when", "say"], `signal ${id}`, "kit_coach", add, line);
    if (seen.has(id)) add("kit_coach", `signal id ${id} is used twice`, line);
    seen.add(id);
    const whenRaw = (signal["when"] ?? {}) as Record<string, unknown>;
    const keys = Object.keys(whenRaw);
    const known = keys.filter((k) => SIGNAL_KEYS.has(k as keyof SignalWhen));
    if (!known.length) {
      add("kit_coach", `signal ${id} has no condition, so it would either never fire or fire ` +
          `on everything. Conditions: ${[...SIGNAL_KEYS].join(", ")}`, line);
    }
    for (const k of keys) {
      if (!SIGNAL_KEYS.has(k as keyof SignalWhen)) {
        add("kit_coach", `signal ${id} has an unknown condition ${k}`, line);
      }
    }
    const when: SignalWhen = {};
    for (const key of ["code_matches", "code_lacks"] as const) {
      if (whenRaw[key] === undefined) continue;
      const pattern = String(whenRaw[key]);
      try {
        coachPattern(pattern);
        when[key] = pattern;
      } catch (error) {
        add("kit_coach", `signal ${id} ${key} "${pattern}" does not compile: ` +
            `${(error as Error).message}`, line);
      }
    }
    if (whenRaw["test_failed"] !== undefined) {
      const name = String(whenRaw["test_failed"]);
      if (!runNames.has(name)) {
        add("kit_coach", `signal ${id} waits for test ${name} to fail, and this problem has ` +
            `no test or probe by that name. Known: ${[...runNames].join(", ") || "none"}`, line);
      }
      when.test_failed = name;
    }
    for (const key of ["idle_minutes", "runs_at_least", "failed_runs_at_least"] as const) {
      if (whenRaw[key] === undefined) continue;
      const n = Number(whenRaw[key]);
      if (!Number.isFinite(n) || n < 0) {
        add("kit_coach", `signal ${id} ${key} must be a number of zero or more`, line);
      } else {
        when[key] = n;
      }
    }
    return {
      id,
      when,
      say: within(signal["say"], L.coachSay, `signal ${id} say`, "kit_coach", add, line),
    };
  });
  return { opening, signals, ...(wrapUp ? { wrap_up: wrapUp } : {}) };
}

function validateBuild(value: unknown, add: Add, lineOf: LineOf): Build | undefined {
  const b = (value ?? {}) as Record<string, unknown>;
  const line = lineOf(["build"]);
  onlyKeys(b, ["id", "title", "stage", "of"], "build", "kit_build", add, line);
  const id = text(b["id"]);
  const stage = Number(b["stage"]);
  const of = Number(b["of"]);
  if (!SLUG.test(id)) add("kit_build", "build.id must be a slug shared by every stage", line);
  const title = within(b["title"], KIT_LIMITS.buildTitle, "build.title", "kit_build", add, line);
  if (!Number.isInteger(stage) || !Number.isInteger(of) || stage < 1 || of < 1 || stage > of) {
    add("kit_build", `build stage ${String(b["stage"])} of ${String(b["of"])} is not a stage ` +
        "inside its build", line);
    return undefined;
  }
  return { id, title, stage, of };
}
