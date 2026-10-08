/**
 * The CI gate over voice-questions/.
 *
 * docs/07 section 2 defines the question object and section 11 the launch
 * set. Neither names a validator, and the standing rule in CLAUDE.md that
 * problem YAML is validated in CI rather than at import applies for the same
 * reason: a beat with no anchors or a rubric that sums to 94 fails in front of
 * a learner who is already speaking, and there is no way to recover a spoken
 * answer.
 *
 * Two rules here are not in docs/07 and are worth saying out loud.
 *
 * Anchors must appear in the strong exemplar. The authoring skill says to
 * write anchors from your own transcript, and an anchor that appears in no
 * real answer lights no cue, so the beat track sits dark through a good
 * answer. Checking it against the transcript is the only mechanical version of
 * that rule available.
 *
 * The rubric may not mention delivery. docs/07 section 6 reports words per
 * minute, filler count and longest pause and scores none of them. A rubric
 * criterion that says "speaks fluently" routes a delivery metric into the
 * score through the judge, which is the same leak tests/fairness.test.ts
 * closes on the code path.
 *
 * A beat's seconds must roughly match the words spent on it. Checking that the
 * beats sum to total_seconds says only that the question is the right length,
 * never that the length is on the right beats, and four of the twelve launch
 * questions hold the right total with a third of it on a beat the strong
 * exemplar covers in a sentence. The cockpit then shows STRETCHING through a
 * good answer. The band is a share against a share, so it holds at any speaking
 * rate, which matters because nobody has measured the real one yet.
 *
 * Amended 9 October 2026 (docs/07 section 2): a question names its round, what
 * it tests in one sentence, the interviewers who ask it, the problems it
 * builds on, a four-line framework card and two to four tips, and every string
 * a learner reads keeps the writing rules, with no em or en dash. Two of the
 * rules are cross-file, checking interviewers and problems against the files
 * that exist, and run only when the caller supplies the sets, which CI does.
 */
import { LineCounter, parseDocument } from "yaml";
import { COMPETENCIES, DIFFICULTIES } from "../problems/vocabulary.ts";
import { proseFindings, sentences } from "./prose.ts";
import { ROUNDS } from "./rounds.ts";

export type VoiceRule =
  | "yaml_syntax" | "schema" | "unknown_competency" | "unknown_track"
  | "beat_count" | "duplicate_beat" | "beat_seconds" | "no_anchors"
  | "anchor_not_in_exemplar" | "total_seconds" | "rubric_weights"
  | "exemplar_bands" | "exemplar_scores" | "follow_up_beat"
  | "delivery_in_rubric" | "beat_allocation"
  // Added 9 October 2026: what a question says about the loop it comes from,
  // and the writing rules on what a learner reads.
  | "round" | "tests_sentence" | "interviewers" | "unknown_interviewer" | "builds_on"
  | "unknown_problem" | "framework" | "tips" | "interview_rounds" | "prose_dash" | "banned_word"
  // The interviewer files, lib/voice/validate-interviewer.ts.
  | "slug" | "listens_for" | "stress_probes" | "cadence" | "voice" | "members";

/**
 * The sets the cross-file rules check against. CI passes both; the import and
 * the unit tests pass neither, and then those two rules are skipped, because
 * the import runs where the problem files may not be.
 */
export interface VoiceValidateOptions {
  /** Slugs of the files in voice-interviewers/. */
  interviewers?: Set<string>;
  /** Slugs of the problem files under problems/, fixtures excluded. */
  problems?: Set<string>;
}

/** docs/07 section 2, amended 9 October 2026: the four lines of the framework card. */
export const FRAMEWORK_KEYS = ["answer_first", "evidence", "trade_off", "if_you_do_not_know"] as const;

const TESTS_MAX_WORDS = 40;
const FRAMEWORK_MAX_SENTENCES = 3;
const TIPS = { min: 2, max: 4 };
const INTERVIEW_ROUNDS = { min: 1, max: 5 };

export interface VoiceError {
  rule: VoiceRule;
  message: string;
  line: number;
  file: string;
}

export interface VoiceReport {
  ok: boolean;
  file: string;
  errors: VoiceError[];
  slug?: string;
}

/** Four to six. docs/07 section 2: three is not a pathway, seven is a script. */
const MIN_BEATS = 4;
const MAX_BEATS = 6;

/** The beat budgets are authored from a timed reading, so they will not sum
 *  exactly. A tenth either way is drift; more than that is a question whose
 *  clock and whose pathway disagree about how long the answer is. */
const SECONDS_TOLERANCE = 0.1;

/** How far a beat's share of the spoken words may diverge from its share of the
 *  clock, either way. Deliberately loose: the widest beat in the launch set sits
 *  at 1.53 and the narrowest at 0.48, both inside questions whose totals are
 *  fine, so 2.5 passes today with room to spare.
 *
 *  It still catches what it exists for, which is a beat holding a handful of
 *  words against a third of the clock, or half the answer against a fifth of it.
 *  Tighten it once somebody has read the set aloud against a stopwatch and the
 *  real speaking rate is known, rather than inferred from a published one. */
const ALLOCATION_BAND = 2.5;

const RUBRIC_WEIGHT_TOTAL = 100;
const BANDS = ["strong", "adequate", "weak"] as const;

/** docs/07 section 6: reported, never scored. */
const DELIVERY_WORDS = /\b(words per minute|wpm|filler|fillers|fluen\w*|accent|um\b|articulat\w*)/i;

export function validateVoiceYaml(
  source: string, file: string, options: VoiceValidateOptions = {},
): VoiceReport {
  const counter = new LineCounter();
  const doc = parseDocument(source, { lineCounter: counter, keepSourceTokens: true });
  const errors: VoiceError[] = [];

  const lineAt = (offset: number | undefined): number =>
    offset === undefined ? 1 : counter.linePos(offset).line;
  const lineOf = (path: Array<string | number>): number => {
    const node = doc.getIn(path, true) as { range?: [number, number, number] } | undefined;
    return lineAt(node?.range?.[0]);
  };
  const add = (rule: VoiceRule, message: string, line: number) =>
    errors.push({ rule, message, line, file });

  for (const problem of doc.errors) add("yaml_syntax", problem.message, lineAt(problem.pos[0]));
  if (doc.errors.length) return { ok: false, file, errors };

  const raw = doc.toJS() as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object") {
    add("schema", "the file does not contain a mapping", 1);
    return { ok: false, file, errors };
  }

  for (const field of ["slug", "title", "track", "difficulty", "total_seconds", "prompt_text"]) {
    if (raw[field] === undefined) add("schema", `${field} is missing`, 1);
  }
  const level = raw["difficulty"] as string;
  if (level && !DIFFICULTIES.includes(level as never)) {
    add("schema", `difficulty ${level} is not one of ${DIFFICULTIES.join(", ")}`,
        lineOf(["difficulty"]));
  }

  // A voice track is a competency slug rather than a problem track: docs/07
  // section 11 lists tool-schema-design and client-communication, which are
  // competencies. Keeping them in one vocabulary is what lets a voice session
  // roll up into the same heatmap column as a code problem.
  const track = raw["track"] as string;
  if (track && !COMPETENCIES.includes(track as never)) {
    add("unknown_track",
        `${track} is not in the competency vocabulary, so a voice session on it would ` +
        `roll up into an orphan heatmap column. Known: ${COMPETENCIES.join(", ")}`,
        lineOf(["track"]));
  }

  const competencies = Array.isArray(raw["competencies"]) ? (raw["competencies"] as string[]) : [];
  competencies.forEach((slug, index) => {
    if (!COMPETENCIES.includes(slug as never)) {
      add("unknown_competency", `${slug} is not in the fixed vocabulary`,
          lineOf(["competencies", index]));
    }
  });
  if (errors.length) return { ok: false, file, errors };

  const beats = Array.isArray(raw["beats"])
    ? (raw["beats"] as Array<{ id?: string; label?: string; seconds?: number; anchors?: string[] }>)
    : [];
  const rubric = Array.isArray(raw["rubric"])
    ? (raw["rubric"] as Array<{ label?: string; weight?: number; descriptor_md?: string }>) : [];
  const exemplars = Array.isArray(raw["exemplars"])
    ? (raw["exemplars"] as Array<{ band?: string; score?: number; transcript?: string }>) : [];
  const followUps = Array.isArray(raw["follow_ups"])
    ? (raw["follow_ups"] as Array<{ trigger_after_beat?: string; text?: string }>) : [];

  if (beats.length < MIN_BEATS || beats.length > MAX_BEATS) {
    add("beat_count",
        `a question needs ${MIN_BEATS} to ${MAX_BEATS} beats, found ${beats.length}. ` +
        "Three is not a pathway and seven is a script", beats.length ? lineOf(["beats", 0]) : 1);
  }

  const seen = new Set<string>();
  let budget = 0;
  beats.forEach((beat, index) => {
    const at = lineOf(["beats", index]);
    if (!beat?.id || !beat?.label) {
      add("schema", `beat ${index + 1} needs an id and a label`, at);
      return;
    }
    if (seen.has(beat.id)) add("duplicate_beat", `two beats share the id ${beat.id}`, at);
    seen.add(beat.id);

    if (typeof beat.seconds !== "number" || beat.seconds < 1) {
      add("beat_seconds", `beat ${beat.id} needs a seconds budget of at least 1`, at);
    } else {
      budget += beat.seconds;
    }
    if (!Array.isArray(beat.anchors) || beat.anchors.length === 0) {
      add("no_anchors",
          `beat ${beat.id} has no anchors, so its segment of the beat track can never ` +
          "light and the territory row renders empty", at);
    }
  });

  const total = Number(raw["total_seconds"] ?? 0);
  if (total > 0 && budget > 0 && Math.abs(budget - total) > total * SECONDS_TOLERANCE) {
    add("total_seconds",
        `the beat budgets sum to ${budget}s against a total_seconds of ${total}s, so the ` +
        "clock and the pathway disagree about how long this answer is",
        lineOf(["total_seconds"]));
  }

  const strong = exemplars.find((e) => e?.band === "strong")?.transcript ?? "";
  const spoken = normalise(strong);
  if (strong) {
    beats.forEach((beat, index) => {
      (beat.anchors ?? []).forEach((anchor, position) => {
        if (!spoken.includes(normalise(String(anchor)))) {
          add("anchor_not_in_exemplar",
              `beat ${beat.id} anchors on "${anchor}", which the strong exemplar never says, ` +
              "so a good answer would leave that cue dark",
              lineOf(["beats", index, "anchors", position]));
        }
      });
    });
  }

  // The beats summing to total_seconds says nothing about where the seconds
  // went. A question can hold the right amount of time and hand a third of it
  // to a beat the strong exemplar covers in one sentence, and the cockpit then
  // shows STRETCHING through a good answer on one beat and OVERRUN on the next.
  if (strong && total > 0 && beats.length) {
    const spend = wordsPerBeat(strong, beats);
    const spoken = [...spend.values()].reduce((sum, n) => sum + n, 0);
    if (spoken > 0) {
      beats.forEach((beat, index) => {
        const seconds = Number(beat?.seconds ?? 0);
        if (!beat?.id || seconds <= 0) return;
        const words = spend.get(beat.id) ?? 0;
        const ratio = (words / spoken) / (seconds / total);
        if (ratio >= ALLOCATION_BAND || ratio <= 1 / ALLOCATION_BAND) {
          const verb = ratio >= ALLOCATION_BAND ? "far more" : "far less";
          add("beat_allocation",
              `beat ${beat.id} is budgeted ${seconds}s of ${total}s but the strong exemplar ` +
              `spends ${verb} of the answer there (${words} of ${spoken} words). ` +
              "The beats sum to the clock and the time is on the wrong ones, so the pace band " +
              "fires on a good answer. Move seconds between beats until each beat's share of " +
              "the clock is near its share of the words, keeping the total the same",
              lineOf(["beats", index]));
        }
      });
    }
  }

  const weights = rubric.reduce((sum, c) => sum + Number(c?.weight ?? 0), 0);
  if (weights !== RUBRIC_WEIGHT_TOTAL) {
    add("rubric_weights",
        `the rubric weights sum to ${weights}, not ${RUBRIC_WEIGHT_TOTAL}`,
        rubric.length ? lineOf(["rubric", 0]) : 1);
  }
  rubric.forEach((criterion, index) => {
    const text = `${criterion?.label ?? ""} ${criterion?.descriptor_md ?? ""}`;
    const hit = text.match(DELIVERY_WORDS);
    if (hit) {
      add("delivery_in_rubric",
          `rubric criterion ${index + 1} mentions "${hit[0]}". Delivery is reported in the ` +
          "debrief and never scored, and a criterion naming it routes it into the score " +
          "through the judge", lineOf(["rubric", index]));
    }
  });

  const bands = exemplars.map((e) => e?.band);
  if (exemplars.length !== 3 || BANDS.some((band) => !bands.includes(band))) {
    add("exemplar_bands",
        `a question needs exactly three exemplars banded ${BANDS.join(", ")}, found ` +
        `${exemplars.length}: ${bands.join(", ") || "none"}`,
        exemplars.length ? lineOf(["exemplars", 0]) : 1);
  }
  exemplars.forEach((exemplar, index) => {
    if (!String(exemplar?.transcript ?? "").trim()) {
      add("schema", `the ${exemplar?.band ?? index} exemplar has no transcript`,
          lineOf(["exemplars", index]));
    }
  });
  const ordered = BANDS.map((band) => exemplars.find((e) => e?.band === band)?.score);
  if (ordered.every((score) => typeof score === "number")) {
    const [high, mid, low] = ordered as [number, number, number];
    if (!(high > mid && mid > low)) {
      add("exemplar_scores",
          `the exemplar scores are ${high}, ${mid}, ${low}, which do not descend from ` +
          "strong to weak, so the judge has no ordering to anchor on",
          lineOf(["exemplars", 0]));
    }
  }

  followUps.forEach((followUp, index) => {
    if (followUp?.trigger_after_beat && !seen.has(followUp.trigger_after_beat)) {
      add("follow_up_beat",
          `follow-up ${index + 1} fires after beat ${followUp.trigger_after_beat}, which does ` +
          "not exist, so pressure mode would never interrupt",
          lineOf(["follow_ups", index]));
    }
  });

  loopRules(raw, options, add, lineOf);
  for (const finding of proseFindings(raw)) {
    add(finding.rule, finding.message, lineOf(finding.path));
  }

  if (errors.length) return { ok: false, file, errors };
  return { ok: true, file, errors, slug: String(raw["slug"]) };
}

/**
 * docs/07 section 2, amended 9 October 2026: what a question says about the
 * loop it comes from and how to answer it. The round and the interviewers are
 * how the picker files it; the framework card and the tips are what the lobby
 * teaches before the answer starts.
 */
function loopRules(
  raw: Record<string, unknown>,
  options: VoiceValidateOptions,
  add: (rule: VoiceRule, message: string, line: number) => void,
  lineOf: (at: Array<string | number>) => number,
): void {
  const round = raw["round"];
  if (typeof round !== "string" || !(ROUNDS as readonly string[]).includes(round)) {
    add("round",
        `round ${round === undefined ? "is missing" : `${String(round)} is not a round`}. It is ` +
        `one of ${ROUNDS.join(", ")}`, round === undefined ? 1 : lineOf(["round"]));
  }

  const tests = raw["tests"];
  const testsText = typeof tests === "string" ? tests.trim() : "";
  if (!testsText || sentences(testsText).length > 1 ||
      testsText.split(/\s+/).length > TESTS_MAX_WORDS || !testsText.endsWith(".")) {
    add("tests_sentence",
        tests === undefined
          ? "tests is missing. Name the competency in one sentence ending in a full stop"
          : `tests has to be one sentence of at most ${TESTS_MAX_WORDS} words ending in a full ` +
            `stop: "${testsText}"`,
        tests === undefined ? 1 : lineOf(["tests"]));
  }

  const interviewers = raw["interviewers"];
  const named = Array.isArray(interviewers) ? interviewers.map(String) : [];
  if (named.length === 0) {
    add("interviewers", "interviewers is missing or empty, so no interviewer asks this question",
        interviewers === undefined ? 1 : lineOf(["interviewers"]));
  }
  if (options.interviewers) {
    const known = options.interviewers;
    named.forEach((slug, index) => {
      if (!known.has(slug)) {
        add("unknown_interviewer",
            `interviewer ${slug} is not in voice-interviewers/. Known: ${[...known].sort().join(", ")}`,
            lineOf(["interviewers", index]));
      }
    });
  }

  const buildsOn = raw["builds_on"];
  const problems = Array.isArray(buildsOn) ? buildsOn.map(String) : [];
  if (problems.length === 0) {
    add("builds_on", "builds_on is missing or empty. Name the problems this question builds on",
        buildsOn === undefined ? 1 : lineOf(["builds_on"]));
  }
  if (options.problems) {
    const known = options.problems;
    problems.forEach((slug, index) => {
      if (!known.has(slug)) {
        add("unknown_problem",
            `builds_on names ${slug}, which is not a problem file under problems/`,
            lineOf(["builds_on", index]));
      }
    });
  }

  const framework = raw["framework"];
  if (!framework || typeof framework !== "object" || Array.isArray(framework)) {
    add("framework", `framework is missing. It has four keys: ${FRAMEWORK_KEYS.join(", ")}`, 1);
  } else {
    const card = framework as Record<string, unknown>;
    for (const key of FRAMEWORK_KEYS) {
      const value = card[key];
      if (typeof value !== "string" || !value.trim()) {
        add("framework", `framework.${key} is missing or empty`, lineOf(["framework"]));
      } else if (sentences(value).length > FRAMEWORK_MAX_SENTENCES) {
        add("framework",
            `framework.${key} runs to ${sentences(value).length} sentences. The card holds at most ` +
            `${FRAMEWORK_MAX_SENTENCES} per line`, lineOf(["framework", key]));
      }
    }
    for (const key of Object.keys(card)) {
      if (!(FRAMEWORK_KEYS as readonly string[]).includes(key)) {
        add("framework", `framework.${key} is not one of ${FRAMEWORK_KEYS.join(", ")}`,
            lineOf(["framework", key]));
      }
    }
  }

  const tips = raw["tips"];
  const tipList = Array.isArray(tips) ? tips : [];
  if (tipList.length < TIPS.min || tipList.length > TIPS.max) {
    add("tips", `tips needs ${TIPS.min} to ${TIPS.max} entries, found ${tipList.length}`,
        tips === undefined ? 1 : lineOf(["tips"]));
  }
  tipList.forEach((tip, index) => {
    const text = typeof tip === "string" ? tip.trim() : "";
    if (!/^[A-Z0-9]/.test(text) || !text.endsWith(".")) {
      add("tips", `tip ${index + 1} is not a full sentence ending in a full stop`,
          lineOf(["tips", index]));
    }
  });

  const rounds = raw["interview_rounds"];
  if (rounds !== undefined &&
      !(typeof rounds === "number" && Number.isInteger(rounds) &&
        rounds >= INTERVIEW_ROUNDS.min && rounds <= INTERVIEW_ROUNDS.max)) {
    add("interview_rounds",
        `interview_rounds is ${String(rounds)}. It is a whole number from ${INTERVIEW_ROUNDS.min} ` +
        `to ${INTERVIEW_ROUNDS.max}, or absent to take the default for the difficulty`,
        lineOf(["interview_rounds"]));
  }
}

/** Words the strong exemplar spends on each beat.
 *
 * A pathway is ordered, so the pointer advances one beat at a time and never
 * rewinds or skips. That matters: in one launch question the second sentence
 * says "it is genuinely your call", which is an anchor of the fifth beat, and a
 * splitter that jumped to whichever beat a sentence mentions credited beat one
 * with twelve words and beat five with the opening. Advancing only into the
 * next beat leaves that sentence where it belongs.
 *
 * The split is approximate either way, since a sentence carrying no anchor stays
 * with the beat before it. The band this feeds is wide enough to absorb that. */
function wordsPerBeat(
  transcript: string,
  beats: Array<{ id?: string; anchors?: string[] }>,
): Map<string, number> {
  const spend = new Map<string, number>(beats.map((b) => [String(b.id), 0]));
  const sentences = transcript.replace(/\s+/g, " ").split(/(?<=[.?!])\s+/).filter(Boolean);
  let at = 0;
  for (const sentence of sentences) {
    const said = normalise(sentence);
    for (let next = beats[at + 1]; next !== undefined; next = beats[at + 1]) {
      if (!(next.anchors ?? []).some((a) => said.includes(normalise(String(a))))) break;
      at += 1;
    }
    const id = String(beats[at]?.id);
    spend.set(id, (spend.get(id) ?? 0) + sentence.split(/\s+/).filter(Boolean).length);
  }
  return spend;
}

/** The same shape of comparison the live cue engine uses: lowercase,
 *  alphanumeric, padded, so punctuation between anchor words still matches. */
function normalise(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
}
