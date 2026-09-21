/**
 * The faculty disagreement queue. docs/10 section 9.7.
 *
 * When P2 and P3 land more than one band apart the consolidator does not take
 * the mean. It marks the disagreement, holds the lower band, and surfaces the
 * row to faculty. This is the surfacing, and it is what makes holding the
 * lower band defensible: without it an unvalidated panelist pulls a grade down
 * and no human ever learns it happened.
 *
 * A review is a reading, not an override. Nothing here writes a score, a band
 * or a competency state, so docs/10 section 13 holds unchanged. What it writes
 * is what a human concluded, which is the record an appeal needs and the list
 * the grade override will work from when somebody builds it.
 */
import type { Pool, PoolClient } from "pg";
import { db, inTransaction } from "../db/pool.ts";
import type { Band } from "../policy/bands.ts";
import type { Complexity } from "../policy/complexity.ts";
import type { Confidence } from "./consolidate.ts";
import type { PanelistName } from "./panel.ts";

export type Disposition = "upheld" | "disputed" | "problem_flagged";
export const DISPOSITIONS: readonly Disposition[] = ["upheld", "disputed", "problem_flagged"];

/** What the queue is filtered to. `open` is the working list. */
export type QueueFilter = Disposition | "open" | "all";

export class NoteRequired extends Error {
  readonly status = 400;
  constructor() {
    super("Recording a review needs a note saying what you concluded and why. " +
          "It is the only record, and the person reading it later is not you.");
    this.name = "NoteRequired";
  }
}

export class NothingToReview extends Error {
  readonly status = 404;
  constructor(evaluationId: number) {
    super(`Evaluation ${evaluationId} is not a disagreement, so there is nothing ` +
          "for a reviewer to settle.");
    this.name = "NothingToReview";
  }
}

export class UnknownDisposition extends Error {
  readonly status = 400;
  constructor(given: string) {
    super(`"${given}" is not a disposition. Use upheld, disputed or problem_flagged.`);
    this.name = "UnknownDisposition";
  }
}

export interface QueueRow {
  evaluationId: number;
  submissionId: number;
  createdAt: string;
  login: string;
  displayName: string;
  slug: string;
  title: string;
  complexity: Complexity;
  confidence: Confidence;
  score: number | null;
  /** The two bands that were more than one step apart. */
  bands: Band[];
  /** The one the learner was given, which is the more cautious of the two. */
  held: Band;
  /** Which panelist said what, because "weak" alone tells faculty nothing. */
  byPanelist: Partial<Record<PanelistName, Band>>;
  review: {
    disposition: Disposition;
    note: string;
    reviewer: string;
    at: string;
  } | null;
}

export interface Queue {
  rows: QueueRow[];
  /** How many are still unreviewed, whatever this page is filtered to. */
  open: number;
}

export interface QueueFilters {
  disposition?: QueueFilter;
  slug?: string;
  limit?: number;
}

interface Row {
  id: string; submission_id: string; created_at: Date; complexity: string;
  confidence: Confidence; score: string | null; disagreement: Disagreement;
  panel: Array<{ panelist: PanelistName; band?: Band }>;
  login: string; display_name: string; slug: string; title: string;
  disposition: Disposition | null; note: string | null;
  reviewer: string | null; reviewed_at: Date | null;
}

interface Disagreement { bands: Band[]; held: Band }

/**
 * Disagreements, oldest first.
 *
 * Oldest first because a queue sorted newest first grows a tail nobody ever
 * reaches, and the tail is where a learner has been sitting on a wrong grade
 * the longest.
 *
 * Only the newest evaluation per submission counts. A re-run that no longer
 * disagrees has settled the argument, and leaving it here would have faculty
 * adjudicating something the platform already fixed.
 */
export async function disagreementQueue(
  filters: QueueFilters = {},
  client: Pool | PoolClient = db(),
): Promise<Queue> {
  const disposition = filters.disposition ?? "open";
  const params: unknown[] = [];
  const where: string[] = [];

  if (disposition === "open") where.push("r.id is null");
  else if (disposition !== "all") {
    params.push(disposition);
    where.push(`r.disposition = $${params.length}::review_disposition`);
  }
  if (filters.slug) {
    params.push(filters.slug);
    where.push(`p.slug = $${params.length}`);
  }
  params.push(Math.min(500, Math.max(1, filters.limit ?? 100)));

  const { rows } = await client.query<Row>(
    `with newest as (
       select distinct on (submission_id) *
         from evaluation
        order by submission_id, created_at desc, id desc
     )
     select e.id, e.submission_id, e.created_at, e.complexity, e.confidence,
            e.score, e.disagreement, e.panel,
            u.github_login as login, u.display_name, p.slug, p.title,
            r.disposition, r.note, r.updated_at as reviewed_at,
            reviewer.github_login as reviewer
       from newest e
       join submission s        on s.id = e.submission_id
       join attempt    a        on a.id = s.attempt_id
       join enrolment  en       on en.id = a.enrolment_id
       join app_user   u        on u.id = en.user_id
       join problem_version v   on v.id = s.problem_version_id
       join problem    p        on p.id = v.problem_id
       left join evaluation_review r on r.evaluation_id = e.id
       left join app_user reviewer   on reviewer.id = r.reviewer_id
      where e.disagreement is not null
        ${where.length ? `and ${where.join(" and ")}` : ""}
      order by e.created_at, e.id
      limit $${params.length}`, params);

  const { rows: counted } = await client.query<{ count: string }>(
    `with newest as (
       select distinct on (submission_id) *
         from evaluation
        order by submission_id, created_at desc, id desc
     )
     select count(*) from newest e
       left join evaluation_review r on r.evaluation_id = e.id
      where e.disagreement is not null and r.id is null`);

  return { rows: rows.map(present), open: Number(counted[0]!.count) };
}

function present(row: Row): QueueRow {
  const byPanelist: Partial<Record<PanelistName, Band>> = {};
  for (const seat of row.panel ?? []) {
    if (seat.band) byPanelist[seat.panelist] = seat.band;
  }

  return {
    evaluationId: Number(row.id),
    submissionId: Number(row.submission_id),
    createdAt: row.created_at.toISOString(),
    login: row.login,
    displayName: row.display_name,
    slug: row.slug,
    title: row.title,
    complexity: row.complexity as Complexity,
    confidence: row.confidence,
    score: row.score === null ? null : Number(row.score),
    bands: row.disagreement.bands,
    held: row.disagreement.held,
    byPanelist,
    review: row.disposition
      ? {
          disposition: row.disposition,
          note: row.note ?? "",
          reviewer: row.reviewer ?? "unknown",
          at: (row.reviewed_at ?? row.created_at).toISOString(),
        }
      : null,
  };
}

export interface ReviewInput {
  evaluationId: number;
  reviewerId: number;
  disposition: Disposition;
  note: string;
}

/**
 * Record what a reviewer concluded.
 *
 * One row per evaluation: a second reading replaces the first rather than
 * stacking, because a queue showing two answers for one row has to be
 * interpreted before it can be worked. The audit row is written either way, so
 * a changed mind stays visible even though the review itself does not.
 */
export async function recordReview(
  input: ReviewInput,
  client?: Pool | PoolClient,
): Promise<void> {
  const note = input.note.trim();
  if (!note) throw new NoteRequired();
  if (!DISPOSITIONS.includes(input.disposition)) {
    throw new UnknownDisposition(String(input.disposition));
  }

  const run = async (tx: Pool | PoolClient) => {
    // A review only means something against a disagreement. Filing one on an
    // evaluation the panel agreed about would put a row in the queue that the
    // queue's own filter says should not be there.
    const { rows } = await tx.query<{ id: string }>(
      "select id from evaluation where id = $1 and disagreement is not null",
      [input.evaluationId]);
    if (!rows.length) throw new NothingToReview(input.evaluationId);

    await tx.query(
      `insert into evaluation_review (evaluation_id, reviewer_id, disposition, note)
       values ($1, $2, $3::review_disposition, $4)
       on conflict (evaluation_id) do update
         set reviewer_id = excluded.reviewer_id,
             disposition = excluded.disposition,
             note        = excluded.note,
             updated_at  = now()`,
      [input.evaluationId, input.reviewerId, input.disposition, note]);

    await tx.query(
      `insert into audit_log (actor_id, action, target, detail)
       values ($1, 'evaluation.review', $2, $3)`,
      [input.reviewerId, `evaluation:${input.evaluationId}`,
       JSON.stringify({ disposition: input.disposition, note })]);
  };

  if (client) await run(client);
  else await inTransaction(run);
}
