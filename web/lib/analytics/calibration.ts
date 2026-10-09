/**
 * The calibration report. docs/11 section 5 and acceptance 8.
 *
 * Written for the author before the next cohort: it names the problem, the
 * signal, the number, and what to check first. The thresholds are things to
 * look at rather than rules to act on, and the report says so, because an
 * author who treats a threshold as a verdict rewrites a problem that was fine.
 *
 * Every number is a count over rows the platform already wrote: first submits
 * and their verdicts, attempts, hint reveals, give-ups, and the panel's own
 * record of where its judges disagreed. Only learners count, so faculty trying
 * a problem out never move its pass rate. Thresholds that depend on the tier
 * come from the policy module (calibrationFor), since nothing outside it reads
 * difficulty to decide anything.
 */
import type { Pool, PoolClient } from "pg";
import { db } from "../db/pool.ts";
import { calibrationFor, difficultyLabel, type Difficulty } from "../policy/tiers.ts";

/**
 * A signal needs this many learners, first attempts or evaluations behind it.
 * docs/11 sets no minimum; a rate over three learners is noise, and the report
 * shows each sample so nobody over-reads one that clears the bar.
 */
export const MIN_SAMPLE = 5;
/** docs/11: below 10 percent, with a high give-up rate. */
export const FIRST_PASS_LOW = 0.1;
/** docs/11 says "high" and gives no number. A quarter of attempts given up is the line here. */
export const GIVE_UP_HIGH = 0.25;
/** docs/11: above 20 percent of evaluations. */
export const DISAGREEMENT_HIGH = 0.2;
/** docs/11 says "far above est_minutes". More than double is the line here. */
export const SLOW_FACTOR = 2;

export type Signal =
  | "first_pass_high" | "first_pass_low" | "disagreement_high" | "hints_high" | "slow_to_pass";

export const SIGNAL_LABEL: Readonly<Record<Signal, string>> = {
  first_pass_high: "First-attempt pass rate high for the tier",
  first_pass_low: "First-attempt pass rate low, with give-ups",
  disagreement_high: "Panel disagreement",
  hints_high: "Hint reveals",
  slow_to_pass: "Time to pass",
};

/** docs/11 section 5's third column: what the signal usually means, as the thing to check. */
const CHECK: Readonly<Record<Signal, string>> = {
  first_pass_high: "Whether the hidden tests can be guessed from the public ones, or the " +
                   "problem sits below its tier.",
  first_pass_low: "Whether the brief and the contract say what the tests check. Read the " +
                  "give-up reasons before changing the problem.",
  disagreement_high: "Whether the rubric criteria can be told apart and the exemplars span " +
                     "the answers learners give.",
  hints_high: "Whether the stub and the step checklist carry a learner to a first passing run.",
  slow_to_pass: "Whether est_minutes is right. This is elapsed time from opening the problem " +
                "to passing it, breaks included, so read it beside the problem's runs.",
};

export interface Finding {
  slug: string;
  title: string;
  difficulty: Difficulty;
  signal: Signal;
  /** The measured number: a rate from 0 to 1, or minutes for slow_to_pass. */
  value: number;
  /** How many learners, first attempts or evaluations the number is over. */
  sample: number;
  /** The line it crossed, in the unit of value. */
  threshold: number;
  /** The number in a sentence. */
  says: string;
  /** What to check first. */
  check: string;
}

/** docs/11 section 5's exemplar coverage: what panelist 2's vote rests on, per problem. */
export interface IndexCoverage {
  slug: string;
  title: string;
  exemplars: number;
  graded: number;
}

export interface CalibrationReport {
  generatedAt: string;
  /** Published problems the report covers. */
  problems: number;
  minSample: number;
  findings: Finding[];
  index: IndexCoverage[];
}

interface Stats {
  slug: string; title: string; difficulty: Difficulty; est_minutes: number;
  firsts: number; first_passes: number; attempts: number; gave_up: number; hinted: number;
  evaluations: number; disagreements: number; passes: number; median_minutes: number | null;
}

const ORDER: readonly Signal[] = [
  "first_pass_high", "first_pass_low", "disagreement_high", "hints_high", "slow_to_pass",
];

const percent = (rate: number) => `${Math.round(rate * 100)} percent`;

export async function calibrationReport(options: {
  minSample?: number; client?: Pool | PoolClient; now?: Date;
} = {}): Promise<CalibrationReport> {
  const client = options.client ?? db();
  const minSample = options.minSample ?? MIN_SAMPLE;

  const { rows } = await client.query<Stats>(
    `with learner_attempts as (
       select a.* from attempt a
         join enrolment e on e.id = a.enrolment_id and e.role = 'learner'
     ),
     firsts as (
       select distinct on (a.id) a.problem_id, s.verdict
         from learner_attempts a join submission s on s.attempt_id = a.id
        where s.kind = 'submit' and s.verdict in ('pass', 'fail')
        order by a.id, s.queued_at, s.id
     ),
     -- The panel's newest word on each submission. A faculty correction comes
     -- from a person and is left out, so it never hides that the judges disagreed.
     newest as (
       select distinct on (ev.submission_id) ev.submission_id, ev.disagreement, v.problem_id
         from evaluation ev
         join submission s on s.id = ev.submission_id
         join learner_attempts a on a.id = s.attempt_id
         join problem_version v on v.id = s.problem_version_id
        where ev.overridden_by is null and ev.state <> 'error'
        order by ev.submission_id, ev.created_at desc, ev.id desc
     )
     select p.slug, p.title, p.difficulty::text as difficulty, p.est_minutes,
            (select count(*) from firsts f where f.problem_id = p.id)::int as firsts,
            (select count(*) from firsts f where f.problem_id = p.id
                and f.verdict = 'pass')::int as first_passes,
            (select count(*) from learner_attempts a where a.problem_id = p.id)::int as attempts,
            (select count(*) from learner_attempts a where a.problem_id = p.id
                and a.gave_up_at is not null)::int as gave_up,
            (select count(*) from learner_attempts a where a.problem_id = p.id
                and a.hints_used > 0)::int as hinted,
            (select count(*) from newest n where n.problem_id = p.id)::int as evaluations,
            (select count(*) from newest n where n.problem_id = p.id
                and n.disagreement is not null)::int as disagreements,
            (select count(*) from learner_attempts a where a.problem_id = p.id
                and a.solved_at is not null)::int as passes,
            (select percentile_cont(0.5) within group
                      (order by extract(epoch from (a.solved_at - a.first_opened_at)) / 60)
               from learner_attempts a
              where a.problem_id = p.id and a.solved_at is not null) as median_minutes
       from problem p
      where p.is_published
      order by p.slug`);

  const findings = rows.flatMap((row) => findingsFor(row, minSample));
  findings.sort((a, b) => a.slug.localeCompare(b.slug) ||
    ORDER.indexOf(a.signal) - ORDER.indexOf(b.signal));

  const { rows: index } = await client.query<IndexCoverage>(
    `select p.slug, p.title,
            count(x.id) filter (where x.source = 'exemplar')::int as exemplars,
            count(x.id) filter (where x.source = 'submission')::int as graded
       from problem p
       left join embedding x on x.problem_id = p.id
      where p.is_published and p.artefact_type in ('design', 'prompt')
      group by p.id, p.slug, p.title
      order by graded, p.slug`);

  return {
    generatedAt: (options.now ?? new Date()).toISOString(),
    problems: rows.length,
    minSample,
    findings,
    index,
  };
}

function findingsFor(row: Stats, minSample: number): Finding[] {
  const out: Finding[] = [];
  const tier = calibrationFor(row.difficulty);
  const label = difficultyLabel(row.difficulty);
  const finding = (signal: Signal, value: number, sample: number, threshold: number,
                   says: string): Finding => ({
    slug: row.slug, title: row.title, difficulty: row.difficulty, signal, value, sample,
    threshold, says, check: CHECK[signal],
  });

  if (row.firsts >= minSample) {
    const rate = row.first_passes / row.firsts;
    const passedFirst = `${row.first_passes} of ${row.firsts} learners passed on their first ` +
      `submit, ${percent(rate)}`;
    if (tier.firstPassAbove !== null && rate > tier.firstPassAbove) {
      out.push(finding("first_pass_high", rate, row.firsts, tier.firstPassAbove,
        `${passedFirst}, above ${percent(tier.firstPassAbove)} on ${label}.`));
    }
    const giveUp = row.attempts === 0 ? 0 : row.gave_up / row.attempts;
    if (rate < FIRST_PASS_LOW && row.attempts >= minSample && giveUp >= GIVE_UP_HIGH) {
      out.push(finding("first_pass_low", rate, row.firsts, FIRST_PASS_LOW,
        `${passedFirst}, and ${row.gave_up} of ${row.attempts} gave up.`));
    }
  }

  if (row.evaluations >= minSample) {
    const rate = row.disagreements / row.evaluations;
    if (rate > DISAGREEMENT_HIGH) {
      out.push(finding("disagreement_high", rate, row.evaluations, DISAGREEMENT_HIGH,
        `${row.disagreements} of ${row.evaluations} evaluations had two judges two bands ` +
        `apart, ${percent(rate)}.`));
    }
  }

  if (tier.hintRevealAbove !== null && row.attempts >= minSample) {
    const rate = row.hinted / row.attempts;
    if (rate > tier.hintRevealAbove) {
      out.push(finding("hints_high", rate, row.attempts, tier.hintRevealAbove,
        `${row.hinted} of ${row.attempts} learners revealed a hint, ${percent(rate)}, above ` +
        `${percent(tier.hintRevealAbove)} on ${label}.`));
    }
  }

  if (row.passes >= minSample && row.median_minutes !== null) {
    const minutes = Math.round(Number(row.median_minutes));
    const limit = SLOW_FACTOR * row.est_minutes;
    if (minutes > limit) {
      out.push(finding("slow_to_pass", minutes, row.passes, limit,
        `The median learner passed ${minutes} minutes after opening it, against an estimate ` +
        `of ${row.est_minutes}.`));
    }
  }

  return out;
}

/** docs/11 section 7: the calibration report as Markdown, dated and counted. */
export function calibrationMarkdown(report: CalibrationReport): string {
  const cell = (value: string) => value.replace(/\|/g, "\\|").replace(/\n/g, " ");
  const lines = [
    "# Calibration report",
    "",
    `Generated ${report.generatedAt}. Covers ${report.problems} published problems. A signal ` +
    `needs at least ${report.minSample} learners, first attempts or evaluations behind it.`,
    "",
    "These are thresholds to look at rather than rules to act on. A problem named here may be " +
    "fine, and the sample beside each number says how much weight it bears.",
    "",
    "## Signals",
    "",
  ];
  if (report.findings.length) {
    lines.push("| Problem | Difficulty | Signal | Number | Check first |", "|---|---|---|---|---|");
    for (const finding of report.findings) {
      lines.push(`| ${cell(finding.title)} (\`${finding.slug}\`) | ${difficultyLabel(finding.difficulty)} | ` +
        `${SIGNAL_LABEL[finding.signal]} | ${cell(finding.says)} | ${cell(finding.check)} |`);
    }
  } else {
    lines.push("No problem crosses a threshold on the sample there is.");
  }
  lines.push("", "## Panelist 2's index", "",
    "Graded answers in the nearest-neighbour index, per design and prompt problem. A band from " +
    "a problem with only its authored exemplars rests on those few points.", "");
  if (report.index.length) {
    lines.push("| Problem | Authored exemplars | Graded answers |", "|---|---|---|");
    for (const row of report.index) {
      lines.push(`| ${cell(row.title)} (\`${row.slug}\`) | ${row.exemplars} | ${row.graded} |`);
    }
  } else {
    lines.push("No design or prompt problem is published.");
  }
  return lines.join("\n") + "\n";
}
