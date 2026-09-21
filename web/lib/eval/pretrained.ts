/**
 * Panelist 2: a band from an embedding, with no model call and no network.
 *
 * It trains nothing. docs/10 section 5 records why: the repository holds 86
 * labelled examples, all author-written and none written by a learner, which
 * is far too few to train a grader and exactly enough to produce one that is
 * confidently wrong about how learners actually fail.
 *
 * So the learning already happened, elsewhere. This embeds the answer and asks
 * which graded answers it sits nearest to. The pool starts as three authored
 * exemplars per problem and grows by one row per graded submission, which is
 * how it comes to know a cohort without a training run.
 */
import type { Pool, PoolClient } from "pg";
import { parse } from "yaml";
import { bandDistance, BANDS, type Band } from "../policy/bands.ts";
import { panelFor } from "../policy/complexity.ts";
import { embed, EMBEDDING_MODEL, similarity, type Embed } from "./embed.ts";
import type { Finding, Panelist, PanelistResult } from "./panel.ts";

/**
 * How many neighbours vote.
 *
 * Three, because a problem's pool starts at exactly three authored exemplars
 * and a k larger than the pool is a k that silently becomes "all of them". It
 * stays useful as the pool grows: the three nearest graded answers are a
 * sharper signal than the twenty nearest.
 */
export const NEIGHBOURS = 3;

/**
 * How far away a nearest neighbour can be before the panelist declines.
 *
 * Cosine similarity on this model's vectors. An answer that resembles nothing
 * in the pool is not a weak answer, it is an answer this panelist has no
 * evidence about, and saying so is worth more than a confident guess.
 */
export const MIN_SIMILARITY = 0.25;

/**
 * A deployment without panelist 2 is not a deployment where panelist 2 broke.
 *
 * The difference decides whether the evaluation goes `partial`, which promises
 * the learner a free re-run, or `complete`, which does not. A worker image
 * built without the model will never encode anything, so calling that an
 * outage would queue a re-evaluation nobody can ever drain, and a promise
 * nobody drains is worse than a plain absence.
 *
 * Everything else here is an outage: a timeout, a crash, a response that did
 * not parse. Those are worth a free re-run because the next attempt may work.
 */
const ABSENT = ["model_missing", "dependency_missing", "spawn_failed"];

export function statusFor(reason: string): "skipped" | "unavailable" {
  return ABSENT.some((prefix) => reason.startsWith(prefix)) ? "skipped" : "unavailable";
}

export interface Neighbour {
  band: Band;
  similarity: number;
  source: string;
}

interface Row { band: string; vector: number[]; source: string }

export interface PretrainedOptions {
  problemId: number;
  sourceYaml: string;
  client: Pool | PoolClient;
  /** Injected by tests, so the panel can be exercised without a 46MB download. */
  embed?: Embed;
}

export function pretrainedPanelist(options: PretrainedOptions): Panelist {
  return {
    name: "pretrained",
    async run(input): Promise<PanelistResult> {
      const started = Date.now();
      const encode = options.embed ?? embed;

      const pool = await neighbourPool(options, encode);
      if (!pool.ok) {
        return { status: statusFor(pool.reason), reason: pool.reason,
                 ms: Date.now() - started, findings: [] };
      }
      if (!pool.rows.length) {
        // A code problem has no graded exemplars to compare against, so there
        // is nothing for this panelist to do rather than something it failed
        // to do.
        return { status: "skipped", reason: "no_graded_pool", ms: Date.now() - started,
                 findings: [] };
      }

      const answer = await encode([input.body]);
      if (!answer.ok) {
        return { status: statusFor(answer.reason), reason: answer.reason,
                 ms: Date.now() - started, findings: [] };
      }

      const neighbours = nearest(answer.vectors[0]!, pool.rows);
      const verdict = vote(neighbours);

      if (!verdict) {
        return {
          status: "ran",
          ms: Date.now() - started,
          findings: [{
            code: "no_close_neighbour",
            detail: "This answer does not resemble any graded answer for this problem.",
            severity: "informational",
          }],
        };
      }

      // The level says how much evidence a band needs before it counts. Below
      // that this panelist says what it saw and withholds the band, which the
      // consolidator reads as silence rather than as a weak answer.
      const required = panelFor(input.complexity).minimumNeighbours;
      if (neighbours.length < required) {
        return {
          status: "ran",
          ms: Date.now() - started,
          findings: [{
            code: "thin_evidence",
            detail: `Only ${neighbours.length} graded answer for this problem is ` +
              "close enough to compare against, which is too few to place this one.",
            severity: "informational",
          }],
        };
      }

      return {
        status: "ran",
        ms: Date.now() - started,
        band: verdict.band,
        findings: findingsFor(verdict, pool.rows.length),
      };
    },
  };
}

/** The k nearest, descending, above the floor. */
export function nearest(vector: number[], rows: Row[], k = NEIGHBOURS): Neighbour[] {
  return rows
    .map((row) => ({
      band: row.band as Band,
      similarity: similarity(vector, row.vector),
      source: row.source,
    }))
    .filter((n) => (BANDS as readonly string[]).includes(n.band) &&
                   n.similarity >= MIN_SIMILARITY)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, k);
}

/**
 * A similarity-weighted vote.
 *
 * Weighted rather than a plain count, because a neighbour at 0.82 is far
 * better evidence than one at 0.31 and counting them equally throws that away.
 */
export function vote(neighbours: Neighbour[]): { band: Band; confidence: number } | null {
  if (!neighbours.length) return null;

  const weights = new Map<Band, number>();
  for (const n of neighbours) {
    weights.set(n.band, (weights.get(n.band) ?? 0) + n.similarity);
  }

  const ranked = [...weights.entries()].sort((a, b) => b[1] - a[1]);
  const [band, weight] = ranked[0]!;
  const total = [...weights.values()].reduce((sum, w) => sum + w, 0);
  return { band, confidence: weight / total };
}

function findingsFor(
  verdict: { band: Band; confidence: number },
  poolSize: number,
): Finding[] {
  const findings: Finding[] = [];
  // A pool that is still only the authored exemplars is a different thing
  // from one with a cohort's answers in it, and a reader should be able to
  // tell without going and counting rows.
  if (poolSize <= 3) {
    findings.push({
      code: "thin_pool",
      detail: `Compared against ${poolSize} graded answers, which is the authored set.`,
      severity: "informational",
    });
  }
  if (verdict.confidence < 0.5) {
    findings.push({
      code: "split_neighbours",
      detail: "The nearest graded answers disagree with each other about this one.",
      severity: "informational",
    });
  }
  return findings;
}

/**
 * Every vector for this problem, seeding the authored exemplars on first use.
 *
 * Lazy rather than populated at import, so publishing content never needs the
 * model on disk. The first submission for a problem pays three encodes and
 * every submission after it pays none.
 */
async function neighbourPool(
  options: PretrainedOptions,
  encode: Embed,
): Promise<{ ok: true; rows: Row[] } | { ok: false; reason: string }> {
  const { rows } = await options.client.query<Row>(
    `select band, vector, source from embedding
      where problem_id = $1 and model = $2`,
    [options.problemId, EMBEDDING_MODEL]);
  if (rows.length) return { ok: true, rows };

  const exemplars = authoredExemplars(options.sourceYaml);
  if (!exemplars.length) return { ok: true, rows: [] };

  const encoded = await encode(exemplars.map((e) => e.text));
  if (!encoded.ok) return { ok: false, reason: encoded.reason };

  for (const [index, exemplar] of exemplars.entries()) {
    await options.client.query(
      `insert into embedding (problem_id, band, source, vector, model)
       values ($1, $2, 'exemplar', $3, $4)`,
      [options.problemId, exemplar.band, encoded.vectors[index], EMBEDDING_MODEL]);
  }

  return {
    ok: true,
    rows: exemplars.map((e, i) => ({
      band: e.band, vector: encoded.vectors[i]!, source: "exemplar",
    })),
  };
}

function authoredExemplars(sourceYaml: string): Array<{ band: string; text: string }> {
  const doc = parse(sourceYaml) as
    { exemplars?: Array<{ band?: string; body_md?: string; transcript?: string }> } | null;
  return (doc?.exemplars ?? [])
    .filter((e) => e.band && (e.body_md || e.transcript))
    .map((e) => ({ band: e.band!, text: (e.body_md ?? e.transcript ?? "").trim() }));
}

/**
 * Add a graded answer to the pool. docs/10 section 5.
 *
 * This is the whole "learns from your cohort without a training run" claim,
 * and it is one insert. Only a band the panel actually settled on is stored:
 * an ungraded or errored submission is not evidence about anything.
 */
export async function rememberGraded(
  client: Pool | PoolClient,
  input: { problemId: number; submissionId: number; band: Band | null; body: string },
  encode: Embed = embed,
): Promise<boolean> {
  if (!input.band) return false;

  const encoded = await encode([input.body]);
  if (!encoded.ok) return false;

  await client.query(
    `insert into embedding (problem_id, band, source, submission_id, vector, model)
     values ($1, $2, 'submission', $3, $4, $5)
     on conflict (submission_id) where submission_id is not null
       do update set band = excluded.band, vector = excluded.vector`,
    [input.problemId, input.band, input.submissionId, encoded.vectors[0], EMBEDDING_MODEL]);
  return true;
}

export { bandDistance };
