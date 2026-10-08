/**
 * The CI gate over voice-interviewers/. docs/07 section 2a.
 *
 * An interviewer is content the same way a question is, and fails in the same
 * place: in front of a learner who is already speaking. A probe that does not
 * end in a question mark is read out as a statement, a cadence of four leaves
 * the fifth round with no kind, and a voice Polly does not offer on the
 * neural engine fails the first synthesis of the day. Each rule below is one
 * of those, refused before the import.
 */
import path from "node:path";
import { LineCounter, parseDocument } from "yaml";
import {
  CADENCE_KINDS, INTERVIEWER_SLUGS, PANEL, POLLY_VOICES,
} from "./interviewers.ts";
import { proseFindings } from "./prose.ts";
import type { VoiceError, VoiceReport, VoiceRule } from "./validate-question.ts";

const REQUIRED = [
  "slug", "name", "role", "listens_for", "opening_line", "follow_up_style", "stress_probes",
  "cadence",
] as const;

const CADENCE_LENGTH = 5;
const LISTENS_FOR = { min: 2, max: 4 };
const PROBES = { min: 2, max: 3 };
const PANEL_MEMBERS = { min: 2, max: 3 };

export function validateInterviewerYaml(
  source: string,
  file: string,
  options: { known?: Set<string> } = {},
): VoiceReport {
  const counter = new LineCounter();
  const doc = parseDocument(source, { lineCounter: counter });
  const errors: VoiceError[] = [];

  const lineAt = (offset: number | undefined): number =>
    offset === undefined ? 1 : counter.linePos(offset).line;
  const lineOf = (at: Array<string | number>): number => {
    const node = doc.getIn(at, true) as { range?: [number, number, number] } | undefined;
    return lineAt(node?.range?.[0]);
  };
  const add = (rule: VoiceRule, message: string, line: number) =>
    errors.push({ rule, message, line, file });

  for (const problem of doc.errors) add("yaml_syntax", problem.message, lineAt(problem.pos[0]));
  if (doc.errors.length) return { ok: false, file, errors };

  const raw = doc.toJS() as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    add("schema", "the file does not contain a mapping", 1);
    return { ok: false, file, errors };
  }

  for (const field of REQUIRED) {
    if (raw[field] === undefined || raw[field] === null || raw[field] === "") {
      add("schema", `${field} is missing`, 1);
    }
  }
  const slug = typeof raw["slug"] === "string" ? raw["slug"] : "";
  const stem = path.basename(file).replace(/\.ya?ml$/, "");
  if (slug && slug !== stem) {
    add("schema", `slug ${slug} does not match the file name ${stem}, and the importer and the ` +
                  "picker both read an interviewer by its slug", lineOf(["slug"]));
  }
  if (slug && !(INTERVIEWER_SLUGS as readonly string[]).includes(slug)) {
    add("slug", `${slug} is not one of the nine: ${INTERVIEWER_SLUGS.join(", ")}`, lineOf(["slug"]));
  }

  const listens = raw["listens_for"];
  if (listens !== undefined) {
    const entries = Array.isArray(listens) ? listens : [];
    if (entries.length < LISTENS_FOR.min || entries.length > LISTENS_FOR.max ||
        entries.some((entry) => typeof entry !== "string" || !entry.trim())) {
      add("listens_for",
          `listens_for needs ${LISTENS_FOR.min} to ${LISTENS_FOR.max} sentences, one per entry, ` +
          `found ${Array.isArray(listens) ? listens.length : "something that is not a list"}`,
          lineOf(["listens_for"]));
    }
  }

  const probes = raw["stress_probes"];
  if (probes !== undefined) {
    const entries = Array.isArray(probes) ? probes : [];
    if (entries.length < PROBES.min || entries.length > PROBES.max) {
      add("stress_probes",
          `stress_probes needs ${PROBES.min} or ${PROBES.max}, found ${entries.length}. They are ` +
          "the last fallback when the model and the authored bank both fail",
          lineOf(["stress_probes"]));
    }
    // A question, or an instruction such as "Walk me through what the on-call
    // engineer sees", which four of the authored probes are. What this
    // catches is a line cut short, which Polly reads out mid-thought.
    entries.forEach((probe, index) => {
      if (typeof probe !== "string" || !/[?.]$/.test(probe.trim())) {
        add("stress_probes",
            `stress probe ${index + 1} does not end in a question mark or a full stop, so it is ` +
            "read out as an unfinished thought", lineOf(["stress_probes", index]));
      }
    });
  }

  const cadence = raw["cadence"];
  if (cadence !== undefined) {
    const entries = Array.isArray(cadence) ? cadence : [];
    const bad = entries.filter((kind) => !(CADENCE_KINDS as readonly unknown[]).includes(kind));
    if (entries.length !== CADENCE_LENGTH || bad.length > 0) {
      add("cadence",
          `cadence needs exactly ${CADENCE_LENGTH} entries over ${CADENCE_KINDS.join(", ")}, ` +
          `found ${entries.length}${bad.length ? ` with ${bad.join(", ")}` : ""}`,
          lineOf(["cadence"]));
    }
  }

  const isPanel = slug === PANEL;
  const voice = raw["voice"] as { id?: unknown; engine?: unknown; language?: unknown } | undefined;
  if (isPanel && voice !== undefined) {
    add("voice", "the panel has no voice of its own: it speaks with its chair's", lineOf(["voice"]));
  } else if (!isPanel && slug) {
    if (!voice || typeof voice !== "object") {
      add("voice", `${slug} has no voice, so nothing they say can be spoken`, 1);
    } else {
      const id = String(voice.id ?? "");
      const language = POLLY_VOICES[id];
      if (!language) {
        add("voice", `voice ${id || "(none)"} is not on the verified list: ` +
                     Object.keys(POLLY_VOICES).join(", "), lineOf(["voice"]));
      }
      if (voice.engine !== "neural") {
        add("voice", `engine ${String(voice.engine)} is not neural, and every voice on the list ` +
                     "was verified on the neural engine", lineOf(["voice"]));
      }
      if (language && voice.language !== language) {
        add("voice", `${id} speaks ${language}, not ${String(voice.language)}`, lineOf(["voice"]));
      }
    }
  }

  const members = raw["members"];
  if (!isPanel && members !== undefined) {
    add("members", `${slug || "a person"} has members, and only the panel is more than one person`,
        lineOf(["members"]));
  }
  if (isPanel) {
    const entries = Array.isArray(members) ? members.map(String) : [];
    if (entries.length < PANEL_MEMBERS.min || entries.length > PANEL_MEMBERS.max) {
      add("members", `the panel needs ${PANEL_MEMBERS.min} or ${PANEL_MEMBERS.max} members, chair ` +
                     `first, found ${entries.length}`, members === undefined ? 1 : lineOf(["members"]));
    }
    entries.forEach((member, index) => {
      if (member === PANEL) {
        add("members", "the panel names itself as a member", lineOf(["members", index]));
      } else if (options.known && !options.known.has(member)) {
        add("members", `member ${member} is not an interviewer in voice-interviewers/`,
            lineOf(["members", index]));
      }
    });
  }

  for (const finding of proseFindings(raw)) {
    add(finding.rule, finding.message, lineOf(finding.path));
  }

  if (errors.length) return { ok: false, file, errors };
  return { ok: true, file, errors, slug };
}
