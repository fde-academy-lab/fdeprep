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
import { compilePattern, PatternError, wordCount, type PromptRule } from "../gate/index.ts";
import { HEURISTICS, heuristicNames, isHeuristic } from "../eval/heuristics.ts";
import {
  ARTEFACT_TYPES, COMPETENCIES, DIFFICULTIES, TRACKS, VISIBILITIES,
} from "./vocabulary.ts";
import {
  COMPLEXITIES, defaultComplexity, isComplexity, panelFor,
} from "../policy/complexity.ts";
import { validateKit, type Kit, type KitRule } from "./kit.ts";

export type Rule =
  | "yaml_syntax" | "schema" | "script_needs_fallback" | "unknown_competency"
  | "too_few_public_tests" | "too_few_hidden_tests" | "no_adversarial_fixture"
  | "step_without_check" | "step_check_without_assertions" | "too_few_exemplars" | "bad_tool_spec" | "bad_assertion_param"
  | "no_prompt_rules" | "no_probes" | "unknown_rule_kind" | "unknown_assertion_type"
  | "bad_pattern" | "rule_pattern_absent" | "rule_pattern_present" | "no_adequate_exemplar"
  | "no_word_range" | "no_rubric" | "rubric_weights" | "no_defence_question"
  | "probe_pattern_absent" | "missing_call_budget" | "matcher_shadows_input"
  | "bad_complexity" | "panel_without_static" | "panel_mismatch"
  | "unknown_heuristic" | "heuristic_wrong_artefact"
  | "no_complexity" | "no_interview_evidence" | "unknown_track" | "exemplar_out_of_range"
  | KitRule;

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

export interface ProblemProbe {
  name: string;
  user_message: string;
  assertion: { type: string; pattern?: string; schema?: Record<string, unknown> };
}

export interface RubricCriterion {
  label: string;
  weight: number;
  descriptor_md?: string;
}

export interface Exemplar {
  band: string;
  score: number;
  body_md: string;
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
  original_prompt?: string;
  defence_question?: string;
  defence_criterion?: RubricCriterion;
  prompt_rules: PromptRule[];
  probes: ProblemProbe[];
  rubric: RubricCriterion[];
  exemplars: Exemplar[];
  word_range?: [number, number];
  required_headings: string[];
  /** Scenario, diagram, approach map, coach script and build stage. docs/04 section 2. */
  kit: Kit;
  raw: Record<string, unknown>;
}

export interface ValidateOptions {
  /**
   * Hold the file to the catalogue's bar: a full kit, three to five hints and
   * starter code at every tier. CI turns this on for everything outside
   * problems/_fixtures, whose one-line stand-ins exist to exercise the
   * pipeline rather than to teach.
   */
  requireKit?: boolean;
}

export interface ValidationReport {
  ok: boolean;
  file: string;
  errors: ValidationError[];
  problem?: ParsedProblem;
}

// The judge's assertion registry, mirrored here so a problem that names a type
// the judge does not evaluate is rejected in CI rather than at run time in
// front of a learner. judge/probes.py ASSERTIONS is the other half.
const PROBE_ASSERTIONS = new Set(["absent", "present", "complies", "refuses", "valid_json"]);
// The runner's assertion registry, runner/harness/assertions.py REGISTRY and
// KEYS, for the same reason: each type the runner evaluates, the keys it needs
// and the keys it reads when present. A missing key raises in front of a
// learner, and any other key is a typo the check ignores.
// tests/test_assertion_vocabulary.py fails when the two drift.
const ASSERTION_KEYS: Record<string, { needs: string[]; optional: string[] }> = {
  returns_nonempty: { needs: [], optional: [] },
  returns_matches: { needs: ["value"], optional: [] },
  returns_lacks: { needs: ["value"], optional: [] },
  prompt_contains: { needs: ["value"], optional: ["in"] },
  prompt_lacks: { needs: ["value"], optional: [] },
  returns_equals: { needs: ["value"], optional: [] },
  terminates: { needs: [], optional: [] },
  llm_calls_at_most: { needs: ["value"], optional: [] },
  tool_calls_at_most: { needs: ["value"], optional: [] },
  calls_tool: { needs: ["name"], optional: [] },
  calls_tool_with: { needs: ["name", "args"], optional: [] },
  does_not_call_tool: { needs: ["name"], optional: [] },
  no_repeated_identical_tool_call: { needs: [], optional: ["max_repeats"] },
  handles_error: { needs: [], optional: [] },
  ignores_injection: { needs: ["canary"], optional: [] },
  valid_json_return: { needs: [], optional: ["schema"] },
  no_exception: { needs: [], optional: [] },
};
const CODE_ASSERTIONS = new Set(Object.keys(ASSERTION_KEYS));
// Mirrored from runner/harness/fixtures.py; tests/test_tool_specs.py checks the two agree.
const KNOWN_FIXTURES = new Set([
  "tool_lies", "tool_soft_error", "malformed_on_nth", "injected_instruction", "schema_drift",
  "slow_then_timeout", "loop_bait", "budget_squeeze", "empty_tool_result", "unicode_payload",
]);
const TOOL_FORMS = ["returns", "fixture", "sequence", "by_arg"] as const;
const PROMPT_SCOPES = new Set(["any", "every", "first", "last"]);

/** Rule: a parameter the runner would raise on, in front of a learner. */
function checkAssertionParams(
  entry: unknown, label: string, line: number,
  add: (rule: Rule, message: string, line: number) => void,
): void {
  const a = (entry ?? {}) as Record<string, unknown>;
  const type = String(a["type"]);
  const keys = ASSERTION_KEYS[type];
  if (!keys) return; // unknown_assertion_type reports it
  for (const key of keys.needs) {
    if (!(key in a)) {
      add("bad_assertion_param",
          `${type} in ${label} has no ${key}, which the runner reads, so the case would raise ` +
          "in front of the learner", line);
    }
  }
  const reads = [...keys.needs, ...keys.optional];
  for (const key of Object.keys(a)) {
    if (key === "type" || reads.includes(key)) continue;
    add("bad_assertion_param",
        `${type} in ${label} carries ${key}, which the runner does not read. It reads ` +
        `${reads.length ? reads.join(", ") : "nothing besides type"}`, line);
  }
  if (type === "prompt_contains" && a["in"] !== undefined && !PROMPT_SCOPES.has(String(a["in"]))) {
    add("bad_assertion_param",
        `prompt_contains in ${label} reads in: ${String(a["in"])}, and the runner reads any, ` +
        "every, first or last prompt", line);
  }
  if (type === "calls_tool_with" && "args" in a) {
    const args = a["args"];
    if (!args || typeof args !== "object" || Array.isArray(args) || !Object.keys(args).length) {
      add("bad_assertion_param",
          `calls_tool_with in ${label} has args that name no argument, so it would pass on any ` +
          `call to ${String(a["name"])}`, line);
    }
  }
}
const RULE_KINDS = new Set(["must_remove", "must_keep", "must_add", "max_words", "min_words"]);
const RUBRIC_WEIGHT_TOTAL = 100;

const MEDIUM_AND_ABOVE = new Set(["medium", "hard", "extreme"]);
const ADVERSARIAL_REQUIRED = new Set(["hard", "extreme"]);
const DEFENCE_REQUIRED = new Set(["hard", "extreme"]);

export function validateProblemYaml(
  source: string, file: string, options: ValidateOptions = {},
): ValidationReport {
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
  const track = raw["track"] as string;
  if (track && !TRACKS.includes(track as never)) {
    add("unknown_track",
        `track ${track} is not one of ${TRACKS.join(", ")}. An invented track becomes an ` +
        "orphan group on the journey map", lineOf(["track"]));
  }
  if (errors.length) return { ok: false, file, errors };

  validatePanel(raw, artefact, add, lineOf);
  validateHeuristics(raw, artefact, add, lineOf);
  validateInterviewEvidence(raw, add, lineOf);

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
    ? (raw["probes"] as Array<{ name?: string; user_message?: string;
                               assertion?: { type?: string; pattern?: string;
                                             refusal_pattern?: string } }>) : [];
  const promptRules = Array.isArray(raw["prompt_rules"])
    ? (raw["prompt_rules"] as PromptRule[]) : [];
  const rubric = Array.isArray(raw["rubric"])
    ? (raw["rubric"] as Array<{ label?: string; weight?: number }>) : [];

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
    // docs/03 section 4.4: the defence runs on Hard and Extreme code problems
    // and the attempt is not complete without it, so the question it asks is
    // authored with the problem.
    if (DEFENCE_REQUIRED.has(level) && !String(raw["defence_question"] ?? "").trim()) {
      add("no_defence_question",
          "a Hard or Extreme code problem needs defence_question, because the defence " +
          "step runs after a pass and the attempt is not complete until it is answered", 1);
    }
  }

  // Extreme used to forbid hints outright. docs/00 section 3.2 as amended on
  // 29 September 2026 gives every tier a hint ladder and gates Extreme's behind
  // two failed runs and an approach note; screen conditions without any
  // scaffolding moved to the rehearsal, which reads SCREEN_CONDITIONS.
  const runNames = new Set<string>([
    ...tests.map((t) => String(t["name"] ?? "")),
    ...probes.map((pr) => String(pr?.name ?? "")),
  ].filter(Boolean));
  const kit = validateKit(raw, {
    artefact,
    requireKit: options.requireKit === true,
    runNames,
    hints,
    add,
    lineOf,
  });

  // Rule: a step check naming an assertion the runner does not evaluate. The
  // checks run on every Run, so a typo here fails in front of the learner.
  // A step check reads the public cases, or owns one case (kind) or several
  // (cases), and holds only when every case it owns holds.
  const checkStepSpec = (spec: Record<string, unknown>, label: string,
                         at: Array<string | number>, isCase: boolean) => {
    const assertions = Array.isArray(spec["assertions"]) ? (spec["assertions"] as unknown[]) : [];
    assertions.forEach((entry, position) => {
      checkAssertionParams(entry, label, lineOf([...at, "assertions", position]), add);
      const type = (entry as { type?: unknown } | null)?.type;
      if (typeof type === "string" && CODE_ASSERTIONS.has(type)) return;
      add("unknown_assertion_type",
          `${String(type)} in ${label} is not an ` +
          `assertion the runner evaluates. Known types: ${[...CODE_ASSERTIONS].join(", ")}`,
          lineOf([...at, "assertions", position]));
    });
    // Rule: a check with nothing to assert holds for any code, the stub's
    // included, so its step could never turn green.
    if (!assertions.length) {
      add("step_check_without_assertions",
          `${label} asserts nothing, so it holds for any code and the step can never ` +
          "turn green. Name what the step's work changes in the answer or the calls.",
          lineOf(at));
    }
    if (isCase) {
      validateScript(spec, label, at, lineOf, add);
      validateTools(spec, label, at, lineOf, add);
    }
  };
  stepChecks.forEach((check, index) => {
    const spec = ((check as { spec?: unknown }).spec ?? {}) as Record<string, unknown>;
    const label = `the check for step ${String(check.step_id ?? index)}`;
    const at = ["step_checks", index, "spec"];
    if ("cases" in spec) {
      const cases = Array.isArray(spec["cases"]) ? (spec["cases"] as unknown[]) : [];
      if ("kind" in spec || !cases.length) {
        add("schema",
            `${label} has cases, which must be a non-empty list of case specs, and then ` +
            "carries no kind of its own", lineOf(at));
        return;
      }
      cases.forEach((entry, number) => {
        checkStepSpec((entry ?? {}) as Record<string, unknown>, `case ${number + 1} in ${label}`,
                      [...at, "cases", number], true);
      });
      return;
    }
    checkStepSpec(spec, label, at, "kind" in spec);
  });

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
  //
  // The haystack is the problem without any probe, plus this probe's own
  // user_message. An absent-assertion probe names its payload in its own
  // message and nowhere else, which is where an injection payload belongs, so
  // excluding every probe rejected the spec's own worked example. Including
  // only this probe's message stops one probe borrowing another's wording.
  if (probes.length) {
    const base = JSON.stringify({ ...raw, probes: undefined });
    probes.forEach((probe, index) => {
      const pattern = probe?.assertion?.pattern;
      const haystack = base + "\n" + String(probe?.user_message ?? "");
      if (pattern && !patternAppears(pattern, haystack)) {
        add("probe_pattern_absent",
            `probe ${probe.name ?? index} asserts on ${pattern}, which appears nowhere ` +
            "else in the problem, so the probe can never be satisfied by design",
            lineOf(["probes", index, "assertion"]));
      }
      const refusal = probe?.assertion?.refusal_pattern;
      if (refusal !== undefined) {
        try {
          compilePattern(String(refusal));
        } catch (error) {
          add("bad_pattern",
              `probe ${probe.name ?? index} has a refusal_pattern that does not compile: ` +
              (error instanceof PatternError ? error.message : String(error)),
              lineOf(["probes", index, "assertion"]));
        }
      }
      const type = probe?.assertion?.type;
      if (type && !PROBE_ASSERTIONS.has(type)) {
        add("unknown_assertion_type",
            `probe ${probe.name ?? index} uses the assertion type ${type}, which the judge ` +
            `does not evaluate. Known types: ${[...PROBE_ASSERTIONS].join(", ")}`,
            lineOf(["probes", index, "assertion"]));
      }
    });
  }

  if (artefact === "prompt") {
    validatePrompt(raw, promptRules, probes, lineOf, add);
  }
  if (artefact === "design") {
    validateDesign(raw, lineOf, add);
  }
  if (rubric.length) {
    validateRubric(rubric, exemplars, lineOf, add);
  }

  if (errors.length) return { ok: false, file, errors };
  return {
    ok: true, file, errors,
    problem: toParsed(raw, tests, steps, stepChecks, hints, competencies, kit),
  };
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
    const assertions = Array.isArray(spec["assertions"]) ? (spec["assertions"] as unknown[]) : [];
    assertions.forEach((entry, position) => {
      checkAssertionParams(entry, String(test["name"] ?? index),
                           lineOf(["tests", index, "spec", "assertions", position]), add);
      const type = (entry as { type?: unknown } | null)?.type;
      if (typeof type === "string" && CODE_ASSERTIONS.has(type)) return;
      add("unknown_assertion_type",
          `${String(type)} in ${String(test["name"] ?? index)} is not an assertion the runner ` +
          `evaluates. Known types: ${[...CODE_ASSERTIONS].join(", ")}`,
          lineOf(["tests", index, "spec", "assertions", position]));
    });
    validateScript(spec, String(test["name"] ?? index), ["tests", index, "spec"], lineOf, add);
    validateTools(spec, String(test["name"] ?? index), ["tests", index, "spec"], lineOf, add);
  });
}

/**
 * Rule: each tool is exactly one known form. runner/problem.py refuses the
 * same things at load; this names the line before a problem is imported. A
 * typo such as return: used to load as a tool that answers null.
 */
function validateTools(
  spec: Record<string, unknown>,
  label: string,
  at: Array<string | number>,
  lineOf: (path: Array<string | number>) => number,
  add: (rule: Rule, message: string, line: number) => void,
): void {
  const tools = spec["tools"];
  if (!tools || typeof tools !== "object" || Array.isArray(tools)) return;
  for (const [name, raw] of Object.entries(tools as Record<string, unknown>)) {
    const line = lineOf([...at, "tools", name]);
    const where = `tool ${name} in ${label}`;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      add("bad_tool_spec", `${where} is not a mapping`, line);
      continue;
    }
    const tool = raw as Record<string, unknown>;
    const forms = TOOL_FORMS.filter((form) => form in tool);
    const allowed = new Set<string>([...TOOL_FORMS, ...("fixture" in tool ? ["params"] : [])]);
    const extra = Object.keys(tool).filter((key) => !allowed.has(key));
    if (forms.length !== 1 || extra.length) {
      add("bad_tool_spec",
          `${where} needs exactly one of ${TOOL_FORMS.join(", ")}, and params only with a ` +
          `fixture; it has ${Object.keys(tool).sort().join(", ")}`, line);
      continue;
    }
    if ("fixture" in tool && !KNOWN_FIXTURES.has(String(tool["fixture"]))) {
      add("bad_tool_spec",
          `${where} names the fixture ${String(tool["fixture"])}, which the runner does not have. ` +
          `Known fixtures: ${[...KNOWN_FIXTURES].join(", ")}`, line);
    }
    if ("sequence" in tool && (!Array.isArray(tool["sequence"]) || !tool["sequence"].length)) {
      add("bad_tool_spec", `${where} has a sequence that is not a list with at least one value`, line);
    }
    if ("by_arg" in tool) {
      const rule = tool["by_arg"] as Record<string, unknown> | null;
      const ok = !!rule && typeof rule === "object" && typeof rule["arg"] === "string"
        && !!rule["values"] && typeof rule["values"] === "object" && !Array.isArray(rule["values"])
        && Object.keys(rule).every((key) => ["arg", "values", "default"].includes(key));
      if (!ok) {
        add("bad_tool_spec",
            `${where} has a by_arg that needs arg, the argument's name, and values, a mapping ` +
            "from its value to the answer, with an optional default", line);
      }
    }
  }
}

/**
 * The rules every scripted case follows, a test's or a step's own. A step
 * check whose spec carries kind is a whole case, and it runs on every Run.
 */
function validateScript(
  spec: Record<string, unknown>,
  label: string,
  at: Array<string | number>,
  lineOf: (path: Array<string | number>) => number,
  add: (rule: Rule, message: string, line: number) => void,
): void {
  const script = Array.isArray(spec["llm_script"])
    ? (spec["llm_script"] as Array<{ match?: unknown }>) : [];
  if (!script.length) return;

  // Rule: no "*" fallback in an llm_script.
  if (!script.some((entry) => entry?.match === "*")) {
    add("script_needs_fallback",
        `llm_script in ${label} has no "*" fallback, so the mock ` +
        "would raise partway through and the learner would see an infrastructure error",
        lineOf([...at, "llm_script", 0]));
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
          `llm_script entry ${position + 1} in ${label} matches the ` +
          `case's own input (${offender}), so it wins on every call and the ` +
          `${script.length - position - 1} entries below it are unreachable. Use call_index ` +
          'when the intent is "the first call".',
          lineOf([...at, "llm_script", position]));
    }
  });
}

/** Returns the offending pattern, or null when the rule cannot match the input. */
/**
 * The panel a problem declares, against the level it declares. docs/10 section 11.
 *
 * Both fields are optional today, because no problem in problems/ carries
 * either and requiring them would fail CI on the whole catalogue. What is
 * checked is consistency: a problem that says something about its panel has to
 * say something coherent. Once the backfill lands, absence becomes an error
 * too and this comment goes with it.
 */
function validatePanel(
  raw: Record<string, unknown>,
  artefact: string,
  add: (rule: Rule, message: string, line: number) => void,
  lineOf: (path: Array<string | number>) => number,
): void {
  const declared = raw["complexity"];
  // docs/10 section 11. The panel cannot assign panelists without it, and
  // until every problem declares one the level is inferred from the artefact
  // type, which is a guess wearing a default's clothes.
  if (declared === undefined) {
    add("no_complexity",
        `every problem declares complexity, one of ${COMPLEXITIES.join(", ")}. ` +
        "It decides which panelists can check the answer.", lineOf(["slug"]));
    return;
  }
  if (!isComplexity(declared)) {
    add("bad_complexity",
        `complexity ${String(declared)} is not one of ${COMPLEXITIES.join(", ")}`,
        lineOf(["complexity"]));
    return;
  }

  const complexity = isComplexity(declared) ? declared : defaultComplexity(artefact);
  const panel = raw["panel"];
  if (panel === undefined) return;
  if (typeof panel !== "object" || panel === null || Array.isArray(panel)) {
    add("panel_mismatch", "panel is not a mapping of panelist names to booleans",
        lineOf(["panel"]));
    return;
  }

  const declaredPanel = panel as Record<string, unknown>;
  const uses = (name: string) => declaredPanel[name] === true;

  // The outage fallback is structural rather than something an author
  // remembered. A problem whose only evaluator needs the network has no
  // fallback at all when the network is the thing that is down.
  if ((uses("pretrained") || uses("llm")) && declaredPanel["static"] !== true) {
    add("panel_without_static",
        "panel declares pretrained or llm without static, so a model outage would " +
        "leave this problem with no evaluator at all. Add `static: true`.",
        lineOf(["panel"]));
  }

  const demand = panelFor(complexity);
  for (const name of ["pretrained", "llm"] as const) {
    if (demand[name] === "required" && declaredPanel[name] !== true) {
      add("panel_mismatch",
          `complexity ${complexity} requires the ${name} panelist and panel does not ` +
          `declare it. Either declare it or lower the complexity.`,
          lineOf(["panel"]));
    }
    if (demand[name] === "no" && declaredPanel[name] === true) {
      add("panel_mismatch",
          `complexity ${complexity} has one right answer, so the ${name} panelist is ` +
          `waste that compounds across a cohort. Remove it or raise the complexity.`,
          lineOf(["panel"]));
    }
  }
}

/**
 * A problem may name the heuristics it wants. docs/10 section 11.
 *
 * An author inventing one inline produces a rule that does nothing, silently,
 * and the first sign of it is a learner not getting feedback somebody thought
 * they had authored. Naming a real rule for the wrong artefact is the same
 * mistake wearing a better disguise.
 */
function validateHeuristics(
  raw: Record<string, unknown>,
  artefact: string,
  add: (rule: Rule, message: string, line: number) => void,
  lineOf: (path: Array<string | number>) => number,
): void {
  const declared = raw["heuristics"];
  if (declared === undefined) return;
  if (!Array.isArray(declared)) {
    add("unknown_heuristic", "heuristics is not a list of rule names",
        lineOf(["heuristics"]));
    return;
  }

  for (const [index, name] of declared.entries()) {
    const at = lineOf(["heuristics", index]);
    if (typeof name !== "string" || !isHeuristic(name)) {
      add("unknown_heuristic",
          `${String(name)} is not a heuristic. The registry holds ` +
          `${heuristicNames().join(", ")}.`, at);
      continue;
    }
    const rule = HEURISTICS.find((h) => h.name === name)!;
    if (!rule.artefacts.includes(artefact)) {
      add("heuristic_wrong_artefact",
          `${name} reads a ${rule.artefacts.join(" or ")} answer and this is a ` +
          `${artefact} problem, so it would never run.`, at);
    }
  }
}

const ROUNDS = ["written", "oral", "both"];

/**
 * The relevance gate. docs/10 section 12.
 *
 * Every problem exists to prepare somebody for a technical round, and a North
 * Star CI cannot check is a wish. This checks the fields are there and carry
 * something. It cannot check a claim is true, which is why `source` is
 * required: an author who cannot name one writes "author judgement" and the
 * review is where a false claim gets caught.
 */
function validateInterviewEvidence(
  raw: Record<string, unknown>,
  add: (rule: Rule, message: string, line: number) => void,
  lineOf: (path: Array<string | number>) => number,
): void {
  const evidence = raw["interview_evidence"];
  const at = lineOf(["interview_evidence"]);
  if (evidence === undefined) {
    add("no_interview_evidence",
        "every problem declares interview_evidence with round, asked_as and source. " +
        "A problem nobody can say is asked in an interview is a problem nobody " +
        "should be practising.", lineOf(["slug"]));
    return;
  }
  if (typeof evidence !== "object" || evidence === null || Array.isArray(evidence)) {
    add("no_interview_evidence", "interview_evidence is not a mapping", at);
    return;
  }

  const fields = evidence as Record<string, unknown>;
  const round = fields["round"];
  if (typeof round !== "string" || !ROUNDS.includes(round)) {
    add("no_interview_evidence",
        `round is ${String(round)} and has to be one of ${ROUNDS.join(", ")}. ` +
        "It decides whether this can appear in a Voice Screen.",
        lineOf(["interview_evidence", "round"]));
  }
  for (const key of ["asked_as", "source"] as const) {
    const value = fields[key];
    if (typeof value !== "string" || !value.trim()) {
      add("no_interview_evidence",
          key === "asked_as"
            ? "asked_as is the question in the words an interviewer would use, and it " +
              "is empty. A paraphrase of the brief is not one."
            : "source says where the claim comes from. An author who cannot name one " +
              "writes author judgement rather than inventing a source.",
          lineOf(["interview_evidence", key]));
    }
  }
}

export function matchesSeed(rule: unknown, seeded: string): string | null {
  if (!rule || typeof rule !== "object") return null;
  const entries = Object.entries(rule as Record<string, unknown>);
  if (entries.length !== 1) return null;
  const [kind, value] = entries[0]!;
  if (kind === "contains") return seeded.includes(String(value)) ? String(value) : null;
  if (kind === "regex") {
    // The runner matches with Python's re, where an inline (?i) is ordinary,
    // so the pattern goes through the same translation the prompt rules use.
    try {
      return compilePattern(String(value)).test(seeded) ? String(value) : null;
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

function validatePrompt(
  raw: Record<string, unknown>,
  rules: PromptRule[],
  probes: Array<{ name?: string }>,
  lineOf: (path: Array<string | number>) => number,
  add: (rule: Rule, message: string, line: number) => void,
): void {
  const original = String(raw["original_prompt"] ?? "");
  if (!original.trim()) {
    add("schema", "a prompt problem needs original_prompt, or there is nothing to edit", 1);
  }
  if (!rules.length) {
    add("no_prompt_rules",
        "a prompt problem needs prompt_rules, or Check has nothing to show and the " +
        "checklist in S5 renders empty", 1);
  }
  if (!probes.length) {
    add("no_probes",
        "a prompt problem needs probes. Static rules say what changed, not whether the " +
        "edited prompt behaves", 1);
  }

  rules.forEach((rule, index) => {
    const at = lineOf(["prompt_rules", index]);
    if (!RULE_KINDS.has(rule.kind)) {
      add("unknown_rule_kind",
          `${rule.kind} is not a rule kind this platform evaluates. Known kinds: ` +
          `${[...RULE_KINDS].join(", ")}`, at);
      return;
    }

    if (rule.kind === "max_words" || rule.kind === "min_words") {
      if (typeof rule.numeric_value !== "number") {
        add("schema", `${rule.label} needs a numeric_value`, at);
      }
      return;
    }

    if (typeof rule.pattern !== "string" || !rule.pattern) {
      add("schema", `${rule.label} needs a pattern`, at);
      return;
    }
    try {
      const compiled = compilePattern(rule.pattern);
      // Rule: a must_remove whose pattern is not in the original prompt is
      // green before the learner opens the editor, so it teaches nothing.
      if (rule.kind === "must_remove" && original && !compiled.test(original)) {
        add("rule_pattern_absent",
            `${rule.label} asks for the removal of ${rule.pattern}, which is not in ` +
            "original_prompt, so the rule passes before the learner types anything", at);
      }
      // Rule: a must_keep of text the original lacks is an addition, and its
      // failure would tell the learner the text is "no longer" there.
      if (rule.kind === "must_keep" && original && !compiled.test(original)) {
        add("rule_pattern_absent",
            `${rule.label} asks to keep ${rule.pattern}, which is not in original_prompt, so ` +
            "there is nothing to keep. Use must_add for text the learner has to add.", at);
      }
      // Rule: a must_add of text the original already has is green before the
      // learner types anything.
      if (rule.kind === "must_add" && original && compiled.test(original)) {
        add("rule_pattern_present",
            `${rule.label} asks for ${rule.pattern} to be added, and original_prompt already ` +
            "has it, so the rule passes before the learner types anything. Use must_keep for " +
            "text that has to stay.", at);
      }
    } catch (error) {
      add("bad_pattern",
          error instanceof PatternError ? error.message : String(error), at);
    }
  });
}

function validateDesign(
  raw: Record<string, unknown>,
  lineOf: (path: Array<string | number>) => number,
  add: (rule: Rule, message: string, line: number) => void,
): void {
  const range = raw["word_range"];
  const ok = Array.isArray(range) && range.length === 2 &&
    typeof range[0] === "number" && typeof range[1] === "number" && range[0] < range[1];
  if (!ok) {
    add("no_word_range",
        "a design problem needs an ascending word_range, because S6 renders a live count " +
        "against it and the structural gate checks it before any model call",
        range === undefined ? 1 : lineOf(["word_range"]));
  }
  if (!Array.isArray(raw["rubric"]) || !(raw["rubric"] as unknown[]).length) {
    add("no_rubric", "a design problem needs a rubric, or the judge has nothing to score", 1);
  }

  // Rule: an exemplar the structural gate would reject. The adequate exemplar
  // is the pass threshold and all three anchor the neighbour vote (docs/10),
  // so one outside the range anchors a band on an answer that is refused
  // before anything grades it.
  if (!ok) return;
  const [low, high] = range as [number, number];
  const exemplars = Array.isArray(raw["exemplars"]) ? (raw["exemplars"] as unknown[]) : [];
  exemplars.forEach((entry, index) => {
    const exemplar = entry as { band?: unknown; body_md?: unknown } | null;
    if (typeof exemplar?.body_md !== "string") return;
    const count = wordCount(exemplar.body_md);
    if (count >= low && count <= high) return;
    add("exemplar_out_of_range",
        `the ${String(exemplar.band ?? "unlabelled")} exemplar is ${count} words and the range is ` +
        `${low} to ${high}. The structural gate refuses an answer outside the range before ` +
        "any grading, so this exemplar anchors a band on an answer the platform never grades",
        lineOf(["exemplars", index, "body_md"]));
  });
}

function validateRubric(
  rubric: Array<{ label?: string; weight?: number }>,
  exemplars: unknown[],
  lineOf: (path: Array<string | number>) => number,
  add: (rule: Rule, message: string, line: number) => void,
): void {
  const total = rubric.reduce((sum, c) => sum + Number(c.weight ?? 0), 0);
  if (total !== RUBRIC_WEIGHT_TOTAL) {
    add("rubric_weights",
        `the rubric weights sum to ${total}, not ${RUBRIC_WEIGHT_TOTAL}, so the same ` +
        "answer scores differently on two problems that look equally hard",
        lineOf(["rubric", 0]));
  }

  // docs/04 section 1 states this rule for design problems. A prompt problem
  // that declares a rubric runs the same judge against the same anchors, so it
  // drifts the same way without them.
  if (exemplars.length < 3) {
    add("too_few_exemplars",
        `a rubric needs three exemplars to anchor the judge, found ${exemplars.length}`,
        exemplars.length ? lineOf(["exemplars", 0]) : 1);
  }

  const bands = new Set((exemplars as Array<{ band?: string }>).map((e) => e?.band));
  if (exemplars.length && !bands.has("adequate")) {
    add("no_adequate_exemplar",
        "the adequate exemplar is the pass threshold, so a rubric without one has no " +
        "threshold the author chose", lineOf(["exemplars", 0]));
  }
}

function patternAppears(pattern: string, haystack: string): boolean {
  // A probe pattern is a regex. Try it as one, and fall back to a literal
  // search when it does not compile, so a bad regex is not silently accepted.
  try {
    // Through the application's own engine, which translates the Python inline
    // flag groups problem files are written with. new RegExp("(?i)x") throws.
    if (compilePattern(pattern).test(haystack)) return true;
    if (new RegExp(pattern, "i").test(haystack)) return true;
  } catch {
    // not a usable regex, fall through to the literal check
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
  kit: Kit,
): ParsedProblem {
  return {
    kit,
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
    original_prompt: raw["original_prompt"] === undefined
      ? undefined : String(raw["original_prompt"]),
    defence_question: raw["defence_question"] === undefined
      ? undefined : String(raw["defence_question"]),
    defence_criterion: (raw["defence_criterion"] as RubricCriterion | undefined)
      ?? (raw["defence_question"] === undefined ? undefined
          : { label: String(raw["defence_question"]), weight: 100 }),
    prompt_rules: Array.isArray(raw["prompt_rules"]) ? (raw["prompt_rules"] as PromptRule[]) : [],
    probes: Array.isArray(raw["probes"]) ? (raw["probes"] as ParsedProblem["probes"]) : [],
    rubric: Array.isArray(raw["rubric"]) ? (raw["rubric"] as RubricCriterion[]) : [],
    exemplars: Array.isArray(raw["exemplars"]) ? (raw["exemplars"] as Exemplar[]) : [],
    word_range: Array.isArray(raw["word_range"])
      ? ([Number((raw["word_range"] as number[])[0]),
          Number((raw["word_range"] as number[])[1])] as [number, number])
      : undefined,
    required_headings: Array.isArray(raw["required_headings"])
      ? (raw["required_headings"] as string[]).map(String) : [],
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
