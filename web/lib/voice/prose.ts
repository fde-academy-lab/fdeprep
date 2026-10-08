/**
 * The writing rules, checked on voice content at import time.
 *
 * .claude/rules/02-writing.md bans a list of words in anything a person reads,
 * and the voice interviewer work added the em and en dash and a list of
 * sentence adverbs to it. tests/test_writing_rules.py checks the same rules over
 * the same files with the content tests. Two checks of one rule in two
 * languages is on purpose: the Python one runs beside the content tests, this
 * one runs wherever a question or an interviewer is validated, the import
 * included, so a file edited after CI still cannot reach a learner with them.
 *
 * What is written badly on purpose is left alone, as the Python test leaves
 * it: a weak or adequate exemplar, and anything inside double quotes, which is
 * how a line quotes the register it warns against.
 */

/** An em dash or an en dash. */
export const DASH = /[\u2013\u2014]/;

/*
 * The lists are written in fragments and joined when this module loads, so
 * that searching the repository for one of the words finds a line that breaks
 * the rule rather than the line that enforces it.
 */

/** The rule's own list, as word forms. One more word on it is banned as a
 *  verb only, which a pattern cannot tell, so it is left to review. */
const BANNED_STEMS = [
  "del" + "v(e|es|ed|ing)", "rob" + "ust(ly|ness)?", "seam" + "less(ly)?", "holis" + "tic(ally)?",
  "un" + "lock(s|ed|ing)?", "ele" + "vat(e|es|ed|ing)", "cruc" + "ial(ly)?", "piv" + "otal",
  "myr" + "iad", "pleth" + "ora", "tapes" + "try", "land" + "scapes?", "re" + "alms?",
  "begin" + "ners?",
];
export const BANNED_WORD = new RegExp(`\\b(${BANNED_STEMS.join("|")})\\b`, "i");

/**
 * The sentence adverbs, matched where they work as one: capitalised, or
 * followed by a comma. A lower-case conjunction inside an authored exemplar
 * passes. The one adjective in the list is matched capitalised only, because
 * in lower case before a comma it is an ordinary word at the end of a clause.
 */
const ADVERBS = [
  "add" + "itionally", "more" + "over", "how" + "ever", "hen" + "ce", "th" + "us",
  "nonethe" + "less", "further" + "more", "accord" + "ingly", "ind" + "eed",
];
const ADJECTIVE = "Dyn" + "amic";
const capitalised = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
export const SENTENCE_ADVERB = new RegExp(
  `\\b(${[...ADVERBS.map(capitalised), ADJECTIVE].join("|")})\\b|\\b(${ADVERBS.join("|")}),`);

/** Keys whose values are matched or quoted rather than read as prose. */
const WRITTEN_BADLY_ON_PURPOSE = new Set(["when", "pattern", "value", "match", "original_prompt"]);
const QUOTED = /"[^"]*"/g;

export type Readable = { path: Array<string | number>; text: string };

/** Every string a learner can read, with where it sits. */
export function readableStrings(node: unknown, path: Array<string | number> = []): Readable[] {
  if (Array.isArray(node)) {
    return node.flatMap((value, index) => readableStrings(value, [...path, index]));
  }
  if (node && typeof node === "object") {
    const record = node as Record<string, unknown>;
    if (record["band"] === "weak" || record["band"] === "adequate") return [];
    return Object.entries(record)
      .filter(([key]) => !WRITTEN_BADLY_ON_PURPOSE.has(key))
      .flatMap(([key, value]) => readableStrings(value, [...path, key]));
  }
  return typeof node === "string" ? [{ path, text: node }] : [];
}

export type ProseFinding = { rule: "prose_dash" | "banned_word"; path: Array<string | number>; message: string };

/** The two writing rules over one document, one finding per string and rule. */
export function proseFindings(document: unknown): ProseFinding[] {
  const findings: ProseFinding[] = [];
  for (const { path, text } of readableStrings(document)) {
    const plain = text.replace(QUOTED, "");
    const where = path.join(".");
    if (DASH.test(plain)) {
      findings.push({
        rule: "prose_dash", path,
        message: `${where} contains an em or en dash. Use a full stop, a comma or a colon instead`,
      });
    }
    const word = plain.match(BANNED_WORD)?.[0] ?? plain.match(SENTENCE_ADVERB)?.[0];
    if (word) {
      findings.push({
        rule: "banned_word", path,
        message: `${where} uses "${word.replace(/,$/, "")}", which .claude/rules/02-writing.md ` +
                 "bans in anything a learner reads. Say the plain thing instead",
      });
    }
  }
  return findings;
}

/** Sentences in a line of prose. A full stop inside a number such as 4.3 is
 *  not a boundary, because the split needs whitespace after it. */
export function sentences(text: string): string[] {
  return text.trim().split(/(?<=[.?!])\s+/).filter(Boolean);
}
