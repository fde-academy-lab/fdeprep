/**
 * The report card. docs/11 section 3, story S15.6.
 *
 * A dated snapshot of one learner for a placement team. The heatmap is live;
 * a card is a document that does not change after somebody reads it, carries
 * the date it was made and can be attached to an email. So it is built once,
 * stored as a row in report_card, and never edited: issuing again writes a
 * new row, and migration 024 refuses an update.
 *
 * The snapshot is canonical JSON (keys sorted, no whitespace) and the row
 * stores exactly those bytes with their SHA-256, which the database checks.
 * The snapshot holds no clock time, so two cards issued from unchanged data
 * hash the same, and a card issued after a new evaluation does not, because
 * the evaluation count is in it (docs/11 acceptance 1 and 2). The time of
 * issue is the row's generated_at, printed on the card beside the hash.
 *
 * Every number is read, never computed here: readiness from readinessFor and
 * coverage from coverageFor in progress/, which Home, Progress and the
 * Overview read too, so a card and a screen cannot disagree (docs/11
 * acceptance 3, docs/12 acceptance 7). Competency states are eval/'s cells,
 * verdicts and scores are what the learner was shown. Two things never
 * appear: delivery, which docs/07 section 6 keeps out of anything a placement
 * conversation reads, and any panelist's name, which only faculty see.
 *
 * Markdown is the export. A PDF needs a renderer this repository does not
 * have, and adding one is a dependency to propose first (CLAUDE.md).
 *
 * The one write analytics/ makes is appending a card. It writes no grade.
 */
import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { db, inTransaction } from "../db/pool.ts";
import type { State } from "../eval/competency.ts";
import { SHAPES, type Persona } from "../policy/roadmap.ts";
import { difficultyLabel, type Difficulty } from "../policy/tiers.ts";
import { coverageFor, type Coverage } from "../progress/coverage.ts";
import { readinessFor, type Readiness, type ReadinessBand } from "../progress/readiness.ts";

/** How many passing submits the evidence section shows. docs/11: up to five. */
export const EVIDENCE = 5;
/** How many voice answers the card lists; the counts above them cover every one. */
export const VOICE_LISTED = 10;

export interface CompetencyLine {
  slug: string;
  name: string;
  /** Submits and rehearsal submits with a verdict the learner earned. */
  submits: number;
  best: State;
  /** The highest tier holding the best state, or null while untouched. */
  reachedAt: Difficulty | null;
  /** Reached without a hint and within the call budget, which is what clean means. */
  clean: boolean;
}

export interface Evidence {
  slug: string;
  title: string;
  difficulty: Difficulty;
  verdict: string;
  score: number | null;
  /** The day it was submitted, YYYY-MM-DD in UTC. */
  on: string;
  /** The trace replay's path, when one was stored. */
  trace: string | null;
  /** The newest evaluation is partial, so the score may still rise. */
  provisional: boolean;
}

export interface VoiceAnswer {
  question: string;
  mode: string;
  input: string;
  on: string;
  score: number;
  content: number;
  structure: number;
  /** Null for a typed answer, which has no clock. */
  pace: number | null;
  beatsCovered: number;
  beats: number;
}

export interface ReportCardSnapshot {
  version: 1;
  learner: { login: string; name: string };
  cohort: { slug: string; name: string };
  persona: Persona;
  track: string;
  /** Evaluation rows on record for this learner, the count the card summarises. */
  evaluations: number;
  readiness: Readiness;
  competencies: CompetencyLine[];
  evidence: Evidence[];
  voice: { finished: number; scored: number; meanScore: number | null; answers: VoiceAnswer[] };
  coverage: Coverage;
  caveats: {
    /** Distinct problems practised, the coverage line's own count. */
    problemsPractised: number;
    /** Published problems. */
    catalogue: number;
    /** Submissions whose newest evaluation is partial. */
    provisional: number;
  };
}

export interface IssuedCard {
  id: number;
  generatedAt: string;
  sha256: string;
  content: string;
  snapshot: ReportCardSnapshot;
}

export interface StoredReportCard extends IssuedCard {
  enrolmentId: number;
  /** The issuer's GitHub login, or null when a script issued it. */
  issuedBy: string | null;
}

export interface CardRow {
  id: number;
  generatedAt: string;
  sha256: string;
  evaluations: number;
  readiness: { percent: number; band: ReadinessBand };
  issuedBy: string | null;
}

/** JSON with every object's keys sorted and no whitespace, so equal data is equal bytes. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error(`a report card holds finite numbers only, and was given ${value}`);
  }
  if (value === undefined) throw new Error("a report card holds no undefined value");
  return JSON.stringify(value);
}

export function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** Two decimal places at most, which is what numeric(5,2) holds. */
const decimal = (value: string | number | null): number | null =>
  value === null ? null : Math.round(Number(value) * 100) / 100;

/** The snapshot, read now. Pure reads: nothing is written. */
export async function buildReportCard(
  enrolmentId: number, client: Pool | PoolClient = db(),
): Promise<ReportCardSnapshot> {
  const { rows: [who] } = await client.query<{
    login: string; name: string; cohort_slug: string; cohort_name: string; persona: Persona;
  }>(
    `select u.github_login as login, u.display_name as name, c.slug as cohort_slug,
            c.name as cohort_name, e.persona::text as persona
       from enrolment e join app_user u on u.id = e.user_id join cohort c on c.id = e.cohort_id
      where e.id = $1`, [enrolmentId]);
  if (!who) throw new Error(`enrolment ${enrolmentId} not found`);

  const readiness = await readinessFor(enrolmentId, client);
  const coverage = await coverageFor(enrolmentId, client);

  const { rows: [counts] } = await client.query<{
    evaluations: number; provisional: number; catalogue: number;
  }>(
    `with mine as (
       select ev.submission_id, ev.state, ev.created_at, ev.id
         from evaluation ev join submission s on s.id = ev.submission_id
         join attempt a on a.id = s.attempt_id
        where a.enrolment_id = $1
     )
     select (select count(*) from mine)::int as evaluations,
            (select count(*) from (
               select distinct on (submission_id) state from mine
                order by submission_id, created_at desc, id desc) newest
              where state = 'partial')::int as provisional,
            (select count(*) from problem where is_published)::int as catalogue`, [enrolmentId]);

  const { rows: lines } = await client.query<{
    slug: string; name: string; difficulty: Difficulty | null; state: State | null; submits: number;
  }>(
    `with best as (
       select distinct on (cs.competency_id) cs.competency_id, cs.difficulty, cs.state
         from competency_score cs
        where cs.enrolment_id = $1
        order by cs.competency_id,
                 case cs.state when 'clean' then 3 when 'passed' then 2
                               when 'attempted' then 1 else 0 end desc,
                 cs.difficulty desc
     )
     select c.slug, c.name, b.difficulty::text as difficulty, b.state,
            (select count(*) from submission s
               join attempt a on a.id = s.attempt_id
               join problem_competency pc on pc.problem_id = a.problem_id
              where a.enrolment_id = $1 and pc.competency_id = c.id
                and s.kind in ('submit', 'rehearsal_submit')
                and s.verdict in ('pass', 'fail'))::int as submits
       from competency c
       left join best b on b.competency_id = c.id
      order by c.slug`, [enrolmentId]);

  const { rows: evidence } = await client.query<{
    slug: string; title: string; difficulty: Difficulty; verdict: string; score: string | null;
    on_day: string; submission_id: string; traced: boolean; provisional: boolean | null;
  }>(
    `select * from (
       select distinct on (p.id) p.slug, p.title, p.difficulty as tier,
              p.difficulty::text as difficulty, s.verdict::text as verdict, s.score,
              to_char(coalesce(s.finished_at, s.queued_at) at time zone 'UTC', 'YYYY-MM-DD') as on_day,
              s.id as submission_id,
              exists (select 1 from trace t where t.submission_id = s.id) as traced,
              (select ev.state = 'partial' from evaluation ev where ev.submission_id = s.id
                order by ev.created_at desc, ev.id desc limit 1) as provisional
         from submission s
         join attempt a on a.id = s.attempt_id
         join problem_version v on v.id = s.problem_version_id
         join problem p on p.id = v.problem_id
        where a.enrolment_id = $1 and s.kind in ('submit', 'rehearsal_submit')
          and s.verdict = 'pass'
        order by p.id, s.score desc nulls last, s.id desc
     ) best
     order by tier desc, score desc nulls last, on_day desc, submission_id desc
     limit $2`, [enrolmentId, EVIDENCE]);

  const { rows: [voiceCounts] } = await client.query<{
    finished: number; scored: number; mean: string | null;
  }>(
    `select count(*)::int as finished,
            count(*) filter (where ${COUNTED_VOICE})::int as scored,
            round(avg(s.score) filter (where ${COUNTED_VOICE}), 1) as mean
       from voice_session s
      where s.enrolment_id = $1 and s.finished_at is not null`, [enrolmentId]);

  const { rows: voice } = await client.query<{
    question: string; mode: string; input: string; on_day: string; score: string;
    content: string | null; structure: string | null; pace: string | null;
    covered: number; beats: number;
  }>(
    `select q.title as question, s.mode::text as mode, s.input,
            to_char(s.finished_at at time zone 'UTC', 'YYYY-MM-DD') as on_day,
            s.score, s.content_score as content, s.structure_score as structure, s.pace_score as pace,
            (select count(*) from voice_beat_result r
              where r.voice_session_id = s.id and r.covered)::int as covered,
            (select count(*) from voice_beat b
              where b.voice_question_id = s.voice_question_id)::int as beats
       from voice_session s join voice_question q on q.id = s.voice_question_id
      where s.enrolment_id = $1 and s.finished_at is not null and ${COUNTED_VOICE}
      order by s.finished_at desc, s.id desc
      limit $2`, [enrolmentId, VOICE_LISTED]);

  return {
    version: 1,
    learner: { login: who.login, name: who.name },
    cohort: { slug: who.cohort_slug, name: who.cohort_name },
    persona: who.persona,
    track: SHAPES[who.persona].name,
    evaluations: counts!.evaluations,
    readiness,
    competencies: lines.map((line) => ({
      slug: line.slug,
      name: line.name,
      submits: line.submits,
      best: line.state ?? "untouched",
      reachedAt: line.difficulty,
      clean: line.state === "clean",
    })),
    evidence: evidence.map((row) => ({
      slug: row.slug,
      title: row.title,
      difficulty: row.difficulty,
      verdict: row.verdict,
      score: decimal(row.score),
      on: row.on_day,
      trace: row.traced ? `/traces/${row.submission_id}` : null,
      provisional: row.provisional === true,
    })),
    voice: {
      finished: voiceCounts!.finished,
      scored: voiceCounts!.scored,
      meanScore: voiceCounts!.mean === null ? null : Number(voiceCounts!.mean),
      answers: voice.map((row) => ({
        question: row.question,
        mode: row.mode,
        input: row.input,
        on: row.on_day,
        score: decimal(row.score)!,
        content: decimal(row.content) ?? 0,
        structure: decimal(row.structure) ?? 0,
        pace: decimal(row.pace),
        beatsCovered: row.covered,
        beats: row.beats,
      })),
    },
    coverage,
    caveats: {
      problemsPractised: coverage.practised,
      catalogue: counts!.catalogue,
      provisional: counts!.provisional,
    },
  };
}

/**
 * A voice answer that was scored and counts: the reading Past answers uses,
 * where an answer stopped too early to count is scored and shows no score.
 * Expects the session aliased `s`.
 */
const COUNTED_VOICE = `(s.scored_at is not null and s.score is not null
  and coalesce(s.judge_result ->> 'skipped', '') <> 'did_not_count')`;

/**
 * Build the snapshot and append it as a new card, in one transaction.
 *
 * Without a caller's transaction this opens one at repeatable read, so every
 * section of the card reads the same moment. With one, it joins the caller's,
 * which is how a test shows readiness on the card equals readiness from
 * progress/ in the same transaction (docs/12 acceptance 7).
 */
export async function issueReportCard(
  input: { enrolmentId: number; issuedBy: number | null },
  client?: PoolClient,
): Promise<IssuedCard> {
  const run = async (tx: PoolClient, own: boolean): Promise<IssuedCard> => {
    if (own) await tx.query("set transaction isolation level repeatable read");
    const snapshot = await buildReportCard(input.enrolmentId, tx);
    const content = canonicalJson(snapshot);
    const sha256 = sha256Hex(content);
    const { rows: [row] } = await tx.query<{ id: string; generated_at: Date }>(
      `insert into report_card (enrolment_id, cohort_id, issued_by, content, content_sha256)
       select e.id, e.cohort_id, $2, $3, $4 from enrolment e where e.id = $1
       returning id, generated_at`,
      [input.enrolmentId, input.issuedBy, content, sha256]);
    return { id: Number(row!.id), generatedAt: row!.generated_at.toISOString(), sha256, content, snapshot };
  };
  return client ? run(client, false) : inTransaction((tx) => run(tx, true));
}

/** One card, from the viewer's cohort only, or null. */
export async function reportCard(
  id: number, cohortId: number, client: Pool | PoolClient = db(),
): Promise<StoredReportCard | null> {
  const { rows: [row] } = await client.query<{
    id: string; enrolment_id: string; generated_at: Date; content: string; content_sha256: string;
    issued_by: string | null;
  }>(
    `select r.id, r.enrolment_id, r.generated_at, r.content, r.content_sha256,
            u.github_login as issued_by
       from report_card r left join app_user u on u.id = r.issued_by
      where r.id = $1 and r.cohort_id = $2`, [id, cohortId]);
  if (!row) return null;
  return {
    id: Number(row.id),
    enrolmentId: Number(row.enrolment_id),
    generatedAt: row.generated_at.toISOString(),
    sha256: row.content_sha256,
    content: row.content,
    snapshot: JSON.parse(row.content) as ReportCardSnapshot,
    issuedBy: row.issued_by,
  };
}

/** A learner's cards, newest first. */
export async function reportCardsFor(
  enrolmentId: number, client: Pool | PoolClient = db(),
): Promise<CardRow[]> {
  const { rows } = await client.query<{
    id: string; generated_at: Date; content: string; content_sha256: string; issued_by: string | null;
  }>(
    `select r.id, r.generated_at, r.content, r.content_sha256, u.github_login as issued_by
       from report_card r left join app_user u on u.id = r.issued_by
      where r.enrolment_id = $1
      order by r.generated_at desc, r.id desc`, [enrolmentId]);
  return rows.map((row) => {
    const snapshot = JSON.parse(row.content) as ReportCardSnapshot;
    return {
      id: Number(row.id),
      generatedAt: row.generated_at.toISOString(),
      sha256: row.content_sha256,
      evaluations: snapshot.evaluations,
      readiness: { percent: snapshot.readiness.percent, band: snapshot.readiness.band },
      issuedBy: row.issued_by,
    };
  });
}

/* ------------------------------------------------------------ Markdown */

const BAND_WORDS: Readonly<Record<ReadinessBand, string>> = {
  not_ready: "not ready",
  developing: "developing",
  screen_ready: "screen ready",
};

const STATE_WORDS: Readonly<Record<State, string>> = {
  clean: "Clean", passed: "Passed", attempted: "Attempted", untouched: "Untouched",
};

const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
const figure = (value: number | null) => value === null ? "none"
  : Number.isInteger(value) ? String(value) : value.toFixed(1);
const cell = (value: string) => value.replace(/\|/g, "\\|").replace(/\n/g, " ");

/** "8 October 2026, 14:02 UTC". */
export function issuedOn(iso: string): string {
  const at = new Date(iso);
  const day = at.toLocaleDateString("en-GB",
    { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const time = at.toLocaleTimeString("en-GB",
    { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
  return `${day}, ${time} UTC`;
}

/**
 * The card as Markdown. Rendered from the stored snapshot, so an old card
 * reads as it did. `origin` makes the trace links absolute for a reader
 * outside the platform.
 */
export function reportCardMarkdown(card: StoredReportCard, options: { origin?: string } = {}): string {
  const s = card.snapshot;
  const r = s.readiness;
  const lines: string[] = [
    `# Report card: ${s.learner.name}`,
    "",
    "| | |",
    "|---|---|",
    `| Learner | ${cell(s.learner.name)} (\`${s.learner.login}\`) |`,
    `| Cohort | ${cell(s.cohort.name)} |`,
    `| Track | ${cell(s.track)} |`,
    `| Persona | ${capital(s.persona)} |`,
    `| Generated | ${issuedOn(card.generatedAt)} |`,
    `| Evaluations summarised | ${s.evaluations} |`,
    `| SHA-256 of the snapshot | \`${card.sha256}\` |`,
    "",
    "## Readiness",
    "",
    `Readiness ${r.percent} percent, ${BAND_WORDS[r.band]}. Clean ${r.clean}, passed ${r.passed}, ` +
    `attempted ${r.attempted} and untouched ${r.untouched}, of the ${r.required} cells the ` +
    "track requires. Only a clean cell counts: a pass with no hint revealed and within the call budget.",
    "",
    "## Competencies",
    "",
    "| Competency | Submits | Best state | Reached at | Without hints, within budget |",
    "|---|---|---|---|---|",
    ...s.competencies.map((line) => `| ${capital(line.name)} | ${line.submits} | ` +
      `${STATE_WORDS[line.best]} | ${line.reachedAt ? difficultyLabel(line.reachedAt) : "none"} | ` +
      `${line.clean ? "Yes" : "No"} |`),
    "",
    "## Evidence",
    "",
  ];

  if (s.evidence.length) {
    lines.push("The passing submits that best show this learner's ceiling, hardest first.", "",
      "| Problem | Difficulty | Verdict | Score | Submitted | Trace |", "|---|---|---|---|---|---|");
    for (const row of s.evidence) {
      const trace = row.trace === null ? "none"
        : options.origin ? `[Replay](${options.origin}${row.trace})` : `\`${row.trace}\``;
      lines.push(`| ${cell(row.title)} | ${difficultyLabel(row.difficulty)} | ${capital(row.verdict)} | ` +
        `${figure(row.score)}${row.provisional ? ", provisional" : ""} | ${row.on} | ${trace} |`);
    }
  } else {
    lines.push("No passing submit yet.");
  }

  lines.push("", "## Voice", "");
  if (s.voice.scored) {
    lines.push(`${s.voice.finished} ${s.voice.finished === 1 ? "answer" : "answers"} finished and ` +
      `${s.voice.scored} scored, with a mean score of ${figure(s.voice.meanScore)} out of 100.` +
      (s.voice.scored > s.voice.answers.length
        ? ` The newest ${s.voice.answers.length} scored answers are listed.` : ""), "",
      "| Question | Mode | Finished | Score | Content | Structure | Pace | Beats covered |",
      "|---|---|---|---|---|---|---|---|");
    for (const answer of s.voice.answers) {
      lines.push(`| ${cell(answer.question)} | ${capital(answer.mode)}, ${answer.input} | ${answer.on} | ` +
        `${figure(answer.score)} | ${figure(answer.content)} | ${figure(answer.structure)} | ` +
        `${answer.pace === null ? "not scored" : figure(answer.pace)} | ` +
        `${answer.beatsCovered} of ${answer.beats} |`);
    }
  } else {
    lines.push(s.voice.finished
      ? `${s.voice.finished} ${s.voice.finished === 1 ? "answer" : "answers"} finished and none scored yet.`
      : "No voice answer finished yet.");
  }
  lines.push("", "Delivery, meaning filler words, pauses and words per minute, is shown to the learner " +
    "and never scored, so it does not appear here.");

  const provisional = s.caveats.provisional;
  lines.push(
    "", "## Interview coverage", "",
    `Practised: written ${s.coverage.written} · oral ${s.coverage.oral}. A problem marked both ` +
    "counts toward each round. Voice answers are listed above and are not counted here.",
    "", "## Caveats", "",
    `- ${s.caveats.problemsPractised} of the ${s.caveats.catalogue} problems in the catalogue ` +
    "have been practised.",
    provisional === 0 ? "- No evaluation in this sample was partial."
      : `- ${provisional} ${provisional === 1 ? "score in this sample is" : "scores in this sample are"} ` +
        "provisional: part of the review had not finished, and the free re-evaluation owed may " +
        "still raise it.",
    "- FDE Prep measures agent engineering. General software ability is outside what it measures.",
    "- This card is a snapshot from the date above. A later card supersedes it, and the platform " +
    "keeps every card that was issued.",
    "", "## Snapshot", "",
    "The SHA-256 above is computed over these exact bytes.", "",
    "```json", card.content, "```", "",
  );
  return lines.join("\n");
}
