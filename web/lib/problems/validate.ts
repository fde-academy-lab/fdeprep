/**
 * The docs/04 section 1 validator.
 *
 * Every failure carries the line it happened on. An import that says only
 * "invalid problem" sends an author hunting through a 200-line file, which is
 * the failure this validator exists to prevent.
 *
 * This runs in CI over problems/ and again behind the admin import screen.
 */
import { LineCounter, parseDocument, type Document } from "yaml";
import {
  ARTEFACT_TYPES, COMPETENCIES, DIFFICULTIES, VISIBILITIES,
} from "./vocabulary.ts";

export type Rule =
  | "yaml_syntax" | "schema" | "script_needs_fallback" | "unknown_competency"
  | "too_few_public_tests" | "too_few_hidden_tests" | "no_adversarial_fixture"
  | "hints_on_extreme" | "step_without_check" | "too_few_exemplars"
  | "probe_pattern_absent" | "missing_call_budget" | "matcher_shadows_input";

export interface ValidationError {
  rule: Rule;
  message: string;
  line: number;
  file: string;
}

export interface ProblemTest {
  name: string;
  visibility: (typeof VISIBILITIES)[number];
  spec: Record<string, unknown>;
  fixture?: string;
  annotation_md?: string;
}

export interface ParsedProblem {
  slug: string;
  title: string;
  artefact_type: (typeof ARTEFACT_TYPES)[number];
  difficulty: (typeof DIFFICULTIES)[number];
  track: string;
  est_minutes: number;
  call_budget?: number;
  time_limit_s: number;
  allowed_imports: string[];
  model_id?: string;
  brief_md: string;
  contract_md?: string;
  stub_code?: string;
  reference_md?: string;
  steps: Array<{ id: string; text: string; check_id: string }>;
  step_checks: Array<{ step_id: string; spec: Record<string, unknown> }>;
  hints: string[];
  competencies: Array<{ slug: string; weight: number }>;
  tests: ProblemTest[];
  raw: Record<string, unknown>;
}

export interface ValidationReport {
  ok: boolean;
  file: string;
  errors: ValidationError[];
  problem?: ParsedProblem;
}

const MEDIUM_AND_ABOVE = new Set(["medium", "hard", "extreme"]);
const ADVERSARIAL_REQUIRED = new Set(["hard", "extreme"]);

export function validateProblemYaml(source: string, file: string): ValidationReport {
  const counter = new LineCounter();
  const doc = parseDocument(source, { lineCounter: counter, keepSourceTokens: true });
  const errors: ValidationError[] = [];

  const lineAt = (offset: number | undefined): number =>
    offset === undefined ? 1 : counter.linePos(offset).line;

  /** Line of a value inside the document, falling back to the file's first line. */
  const lineOf = (path: Array<string | number>): number => {
    const node = doc.getIn(path, true) as { range?: [number, number, number] } | undefined;
    return lineAt(node?.range?.[0]);
  };

  const add = (rule: Rule, message: string, line: number) =>
    errors.push({ rule, message, line, file });

  for (const problem of doc.errors) {
    add("yaml_syntax", problem.message, lineAt(problem.pos[0]));
  }
  if (doc.errors.length) return { ok: false, file, errors };

  const raw = doc.toJS() as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object") {
    add("schema", "the file does not contain a mapping", 1);
    return { ok: false, file, errors };
  }

  for (const field of ["slug", "title", "artefact_type", "difficulty", "track"]) {
    if (raw[field] === undefined) add("schema", `${field} is missing`, 1);
  }
  const artefact = raw["artefact_type"] as string;
  const level = raw["difficulty"] as string;
  if (artefact && !ARTEFACT_TYPES.includes(artefact as never)) {
    add("schema", `artefact_type ${artefact} is not one of ${ARTEFACT_TYPES.join(", ")}`,
        lineOf(["artefact_type"]));
  }
  if (level && !DIFFICULTIES.includes(level as never)) {
    add("schema", `difficulty ${level} is not one of ${DIFFICULTIES.join(", ")}`,
        lineOf(["difficulty"]));
  }
  if (errors.length) return { ok: false, file, errors };

  const tests = Array.isArray(raw["tests"]) ? (raw["tests"] as Record<string, unknown>[]) : [];
  const competencies = Array.isArray(raw["competencies"])
    ? (raw["competencies"] as Array<{ slug?: string; weight?: number }>) : [];
  const hints = Array.isArray(raw["hints"]) ? (raw["hints"] as string[]) : [];
  const steps = Array.isArray(raw["steps"])
    ? (raw["steps"] as Array<{ id?: string; check_id?: string; text?: string }>) : [];
  const stepChecks = Array.isArray(raw["step_checks"])
    ? (raw["step_checks"] as Array<{ step_id?: string }>) : [];
  const exemplars = Array.isArray(raw["exemplars"]) ? (raw["exemplars"] as unknown[]) : [];
  const probes = Array.isArray(raw["probes"])
    ? (raw["probes"] as Array<{ name?: string; assertion?: { pattern?: string } }>) : [];

  // Rule: a competency tag outside the fixed vocabulary.
  competencies.forEach((entry, index) => {
    if (entry?.slug && !COMPETENCIES.includes(entry.slug as never)) {
      add("unknown_competency",
          `${entry.slug} is not in the fixed vocabulary, and an invented tag creates an ` +
          `orphan column in the heatmap. Known tags: ${COMPETENCIES.join(", ")}`,
          lineOf(["competencies", index]));
    }
  });

  // Rule: call_budget not set on a code problem.
  if (artefact === "code" && raw["call_budget"] === undefined) {
    add("missing_call_budget",
        "a code problem without call_budget silently disables budget scoring", 1);
  }

  if (artefact === "code") {
    validateTests(tests, level, lineOf, add);
  }

  // Rule: hints present on an extreme problem.
  if (level === "extreme" && hints.length > 0) {
    add("hints_on_extreme",
        "Extreme problems carry no hints at any point, which the tier exists to enforce",
        lineOf(["hints", 0]));
  }

  // Rule: steps present without matching step_check entries.
  const checked = new Set(stepChecks.map((c) => c.step_id));
  steps.forEach((step, index) => {
    const wanted = step.check_id ?? step.id;
    if (wanted && !checked.has(wanted)) {
      add("step_without_check",
          `step ${step.id ?? index} has no step_check for ${wanted}, so the Easy ` +
          "checklist would show an item that never turns green",
          lineOf(["steps", index]));
    }
  });

  // Rule: fewer than three rubric exemplars on a design problem.
  if (artefact === "design" && exemplars.length < 3) {
    add("too_few_exemplars",
        `a design problem needs three exemplars to anchor the judge, found ${exemplars.length}`,
        exemplars.length ? lineOf(["exemplars", 0]) : 1);
  }

  // Rule: a probe whose assertion references a pattern absent from the problem.
  if (probes.length) {
    const haystack = JSON.stringify({ ...raw, probes: undefined });
    probes.forEach((probe, index) => {
      const pattern = probe?.assertion?.pattern;
      if (pattern && !patternAppears(pattern, haystack)) {
        add("probe_pattern_absent",
            `probe ${probe.name ?? index} asserts on ${pattern}, which appears nowhere ` +
            "else in the problem, so the probe can never be satisfied by design",
            lineOf(["probes", index, "assertion"]));
      }
    });
  }

  if (errors.length) return { ok: false, file, errors };
  return { ok: true, file, errors, problem: toParsed(raw, tests, steps, stepChecks, hints, competencies) };
}

function validateTests(
  tests: Record<string, unknown>[],
  level: string,
  lineOf: (path: Array<string | number>) => number,
  add: (rule: Rule, message: string, line: number) => void,
): void {
  const by = (v: string) => tests.filter((t) => (t["visibility"] ?? "public") === v);

  if (by("public").length < 2) {
    add("too_few_public_tests",
        `a learner needs something to iterate against, found ${by("public").length} public tests`, 1);
  }
  if (MEDIUM_AND_ABOVE.has(level) && by("hidden").length < 2) {
    add("too_few_hidden_tests",
        `one hidden test is guessable, found ${by("hidden").length} on a ${level} problem`, 1);
  }
  if (ADVERSARIAL_REQUIRED.has(level) && by("adversarial").length === 0) {
    add("no_adversarial_fixture",
        `the adversarial battery is what the ${level} tier exists for, and this problem has none`, 1);
  }

  tests.forEach((test, index) => {
    const spec = (test["spec"] ?? {}) as Record<string, unknown>;
    const script = Array.isArray(spec["llm_script"])
      ? (spec["llm_script"] as Array<{ match?: unknown }>) : [];
    if (!script.length) return;

    // Rule: no "*" fallback in an llm_script.
    if (!script.some((entry) => entry?.match === "*")) {
      add("script_needs_fallback",
          `llm_script in ${String(test["name"] ?? index)} has no "*" fallback, so the mock ` +
          "would raise partway through and the learner would see an infrastructure error",
          lineOf(["tests", index, "spec", "llm_script", 0]));
    }

    // Rule: a matcher that already matches the case's own input wins on every
    // call once a scratchpad keeps the input in the prompt.
    const seeded = Object.values((spec["input"] ?? {}) as Record<string, unknown>)
      .map(String).join(" ");
    if (!seeded) return;
    script.slice(0, -1).forEach((entry, position) => {
      const offender = matchesSeed(entry?.match, seeded);
      if (offender !== null) {
        add("matcher_shadows_input",
            `llm_script entry ${position + 1} in ${String(test["name"] ?? index)} matches the ` +
            `case's own input (${offender}), so it wins on every call and the ` +
            `${script.length - position - 1} entries below it are unreachable. Use call_index ` +
            'when the intent is "the first call".',
            lineOf(["tests", index, "spec", "llm_script", position]));
      }
    });
  });
}

/** Returns the offending pattern, or null when the rule cannot match the input. */
export function matchesSeed(rule: unknown, seeded: string): string | null {
  if (!rule || typeof rule !== "object") return null;
  const entries = Object.entries(rule as Record<string, unknown>);
  if (entries.length !== 1) return null;
  const [kind, value] = entries[0]!;
  if (kind === "contains") return seeded.includes(String(value)) ? String(value) : null;
  if (kind === "regex") {
    try {
      return new RegExp(String(value)).test(seeded) ? String(value) : null;
    } catch {
      return null;
    }
  }
  if (kind === "all" && Array.isArray(value)) {
    const hits = value.map((nested) => matchesSeed(nested, seeded));
    if (hits.length && hits.every((hit) => hit !== null)) return hits.join(", ");
  }
  return null;
}

function patternAppears(pattern: string, haystack: string): boolean {
  // A probe pattern is a regex. Try it as one, and fall back to a literal
  // search when it does not compile, so a bad regex is not silently accepted.
  try {
    if (new RegExp(pattern, "i").test(haystack)) return true;
  } catch {
    // not a valid regex, fall through to the literal check
  }
  const literal = pattern.replace(/[(){}[\]|?*+^$\\.]/g, "");
  return literal.length > 2 && haystack.toLowerCase().includes(literal.toLowerCase());
}

function toParsed(
  raw: Record<string, unknown>,
  tests: Record<string, unknown>[],
  steps: Array<{ id?: string; text?: string; check_id?: string }>,
  stepChecks: Array<{ step_id?: string; spec?: unknown }>,
  hints: string[],
  competencies: Array<{ slug?: string; weight?: number }>,
): ParsedProblem {
  return {
    slug: String(raw["slug"]),
    title: String(raw["title"] ?? raw["slug"]),
    artefact_type: raw["artefact_type"] as ParsedProblem["artefact_type"],
    difficulty: raw["difficulty"] as ParsedProblem["difficulty"],
    track: String(raw["track"]),
    est_minutes: Number(raw["est_minutes"] ?? 20),
    call_budget: raw["call_budget"] === undefined ? undefined : Number(raw["call_budget"]),
    time_limit_s: Number(raw["time_limit_s"] ?? 10),
    allowed_imports: Array.isArray(raw["allowed_imports"])
      ? (raw["allowed_imports"] as string[]).map(String) : [],
    model_id: raw["model_id"] === undefined ? undefined : String(raw["model_id"]),
    brief_md: String(raw["brief_md"] ?? ""),
    contract_md: raw["contract_md"] === undefined ? undefined : String(raw["contract_md"]),
    stub_code: raw["stub_code"] === undefined ? undefined : String(raw["stub_code"]),
    reference_md: raw["reference_md"] === undefined ? undefined : String(raw["reference_md"]),
    steps: steps.map((s, i) => ({
      id: String(s.id ?? `s${i + 1}`), text: String(s.text ?? ""),
      check_id: String(s.check_id ?? s.id ?? `s${i + 1}`),
    })),
    step_checks: stepChecks.map((c) => ({
      step_id: String(c.step_id), spec: (c.spec ?? {}) as Record<string, unknown>,
    })),
    hints: hints.map(String),
    competencies: competencies.map((c) => ({
      slug: String(c.slug), weight: Number(c.weight ?? 1),
    })),
    tests: tests.map((t) => ({
      name: String(t["name"]),
      visibility: (t["visibility"] ?? "public") as ProblemTest["visibility"],
      spec: (t["spec"] ?? {}) as Record<string, unknown>,
      fixture: t["fixture"] === undefined ? undefined : String(t["fixture"]),
      annotation_md: t["annotation_md"] === undefined ? undefined : String(t["annotation_md"]),
    })),
    raw,
  };
}
