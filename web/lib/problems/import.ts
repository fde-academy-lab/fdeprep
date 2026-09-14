/**
 * The admin import action.
 *
 * Problem content is versioned: a submission always points at the version it
 * ran against, so editing a problem never rewrites history. An import that
 * changes anything writes a new problem_version rather than updating one.
 */
import type { PoolClient } from "pg";
import { db, inTransaction } from "../db/pool.ts";
import { validateProblemYaml, type ParsedProblem } from "./validate.ts";

export interface FieldChange {
  field: string;
  before: string | null;
  after: string | null;
}

export interface ImportPreview {
  slug: string;
  action: "create" | "new_version" | "unchanged";
  currentVersion: number | null;
  nextVersion: number;
  changes: FieldChange[];
}

const VERSIONED_FIELDS = [
  "brief_md", "contract_md", "stub_code", "reference_md", "model_id",
] as const;

/** What publishing would do, shown before anything is written. */
export async function previewImport(
  parsed: ParsedProblem, sourceYaml: string,
): Promise<ImportPreview> {
  const { rows } = await db().query<{
    version: number; source_yaml: string; title: string; difficulty: string;
    track: string; est_minutes: number;
  }>(
    `select v.version, v.source_yaml, p.title, p.difficulty::text, p.track, p.est_minutes
       from problem p join problem_version v
         on v.problem_id = p.id and v.version = p.current_version
      where p.slug = $1`, [parsed.slug]);

  const current = rows[0];
  if (!current) {
    return {
      slug: parsed.slug, action: "create", currentVersion: null, nextVersion: 1,
      changes: [{ field: "problem", before: null, after: `new ${parsed.difficulty} ${parsed.artefact_type} problem` }],
    };
  }

  if (current.source_yaml === sourceYaml) {
    return {
      slug: parsed.slug, action: "unchanged", currentVersion: current.version,
      nextVersion: current.version, changes: [],
    };
  }

  const before = parseYamlFields(current.source_yaml);
  const changes: FieldChange[] = [];
  const note = (field: string, a: string | null, b: string | null) => {
    if (a !== b) changes.push({ field, before: a, after: b });
  };

  note("title", current.title, parsed.title);
  note("difficulty", current.difficulty, parsed.difficulty);
  note("track", current.track, parsed.track);
  note("est_minutes", String(current.est_minutes), String(parsed.est_minutes));
  for (const field of VERSIONED_FIELDS) {
    note(field, summarise(before[field]), summarise(parsed[field] ?? null));
  }
  note("tests", String(countTests(before["_tests"])), String(parsed.tests.length));
  note("hints", String(countTests(before["_hints"])), String(parsed.hints.length));

  return {
    slug: parsed.slug, action: "new_version", currentVersion: current.version,
    nextVersion: current.version + 1, changes,
  };
}

export interface PublishOptions {
  publish?: boolean;
  actorId?: number;
}

export interface PublishResult {
  problemId: number;
  version: number;
  action: ImportPreview["action"];
}

export async function publishImport(
  parsed: ParsedProblem, sourceYaml: string, options: PublishOptions = {},
): Promise<PublishResult> {
  const preview = await previewImport(parsed, sourceYaml);
  if (preview.action === "unchanged") {
    const { rows } = await db().query<{ id: string; current_version: number }>(
      "select id, current_version from problem where slug = $1", [parsed.slug]);
    return {
      problemId: Number(rows[0]!.id), version: rows[0]!.current_version, action: "unchanged",
    };
  }

  return inTransaction(async (client) => {
    const problemId = await upsertProblem(client, parsed, preview.nextVersion, options.publish);
    const versionId = await insertVersion(client, problemId, parsed, sourceYaml, preview.nextVersion);
    await insertChildren(client, problemId, versionId, parsed);

    if (options.actorId) {
      await client.query(
        `insert into audit_log (actor_id, action, target, detail)
         values ($1, 'problem.publish', $2, $3)`,
        [options.actorId, parsed.slug,
         JSON.stringify({ version: preview.nextVersion, action: preview.action })]);
    }
    return { problemId, version: preview.nextVersion, action: preview.action };
  });
}

async function upsertProblem(
  client: PoolClient, parsed: ParsedProblem, version: number, publish = false,
): Promise<number> {
  const { rows } = await client.query<{ id: string }>(
    `insert into problem (slug, title, artefact_type, difficulty, track, est_minutes,
                          is_published, current_version)
     values ($1, $2, $3::artefact_type, $4::difficulty, $5, $6, $7, $8)
     on conflict (slug) do update set
       title = excluded.title, artefact_type = excluded.artefact_type,
       difficulty = excluded.difficulty, track = excluded.track,
       est_minutes = excluded.est_minutes, current_version = excluded.current_version,
       is_published = problem.is_published or excluded.is_published
     returning id`,
    [parsed.slug, parsed.title, parsed.artefact_type, parsed.difficulty, parsed.track,
     parsed.est_minutes, publish, version]);
  return Number(rows[0]!.id);
}

async function insertVersion(
  client: PoolClient, problemId: number, parsed: ParsedProblem,
  sourceYaml: string, version: number,
): Promise<number> {
  const { rows } = await client.query<{ id: string }>(
    `insert into problem_version (problem_id, version, source_yaml, brief_md, contract_md,
                                  stub_code, steps, reference_md, model_id, call_budget,
                                  time_limit_s, allowed_imports,
                                  original_prompt, prompt_rules, word_range,
                                  required_headings, rubric, probe_count,
                                  defence_question, defence_criterion)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
     returning id`,
    [problemId, version, sourceYaml, parsed.brief_md, parsed.contract_md ?? null,
     parsed.stub_code ?? null, JSON.stringify(parsed.steps), parsed.reference_md ?? null,
     parsed.model_id ?? null, parsed.call_budget ?? null, parsed.time_limit_s,
     JSON.stringify(parsed.allowed_imports),
     // Probes and exemplars are not here on purpose: they stay in source_yaml,
     // which only the judge worker reads, so no view can leak probe wording.
     parsed.original_prompt ?? null, JSON.stringify(parsed.prompt_rules),
     parsed.word_range ? JSON.stringify(parsed.word_range) : null,
     JSON.stringify(parsed.required_headings), JSON.stringify(parsed.rubric),
     parsed.probes.length, parsed.defence_question ?? null,
     parsed.defence_criterion ? JSON.stringify(parsed.defence_criterion) : null]);
  return Number(rows[0]!.id);
}

async function insertChildren(
  client: PoolClient, problemId: number, versionId: number, parsed: ParsedProblem,
): Promise<void> {
  for (const [ordinal, test] of parsed.tests.entries()) {
    await client.query(
      `insert into problem_test (problem_version_id, name, visibility, ordinal, spec,
                                 fixture_slug, annotation_md)
       values ($1,$2,$3::test_visibility,$4,$5,$6,$7)`,
      [versionId, test.name, test.visibility, ordinal, JSON.stringify(test.spec),
       test.fixture ?? null, test.annotation_md ?? null]);
  }
  for (const [ordinal, body] of parsed.hints.entries()) {
    await client.query(
      `insert into hint (problem_version_id, ordinal, body_md) values ($1,$2,$3)`,
      [versionId, ordinal + 1, body]);
  }
  for (const check of parsed.step_checks) {
    await client.query(
      `insert into step_check (problem_version_id, step_id, spec) values ($1,$2,$3)`,
      [versionId, check.step_id, JSON.stringify(check.spec)]);
  }
  for (const competency of parsed.competencies) {
    const { rows } = await client.query<{ id: string }>(
      `insert into competency (slug, name) values ($1,$2)
       on conflict (slug) do update set name = excluded.name returning id`,
      [competency.slug, competency.slug.replace(/-/g, " ")]);
    await client.query(
      `insert into problem_competency (problem_id, competency_id, weight)
       values ($1,$2,$3) on conflict (problem_id, competency_id)
       do update set weight = excluded.weight`,
      [problemId, Number(rows[0]!.id), competency.weight]);
  }
}

function parseYamlFields(source: string): Record<string, string | null | unknown> {
  // The diff only needs a coarse before-picture, and the stored source is
  // already known to have validated, so a full re-parse is enough.
  try {
    const report = validateProblemYaml(source, "stored");
    if (!report.problem) return {};
    return {
      ...report.problem, _tests: report.problem.tests, _hints: report.problem.hints,
    } as Record<string, unknown>;
  } catch {
    return {};
  }
}

function summarise(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  const firstLine = text.split("\n")[0] ?? "";
  return text.length > 60 ? `${firstLine.slice(0, 57)}...` : text;
}

function countTests(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}
