/**
 * Who asks the question. docs/07 section 2a, added 9 October 2026.
 *
 * Nine interviewers live in voice-interviewers/, one YAML file each, and are
 * imported into voice_interviewer by the same operator action that imports the
 * questions. The browser names a slug and nothing else: the voice, the opening
 * line, the probes and the follow-up style are all resolved here, on the
 * server, from the row. A browser that could name a voice or a probe could
 * name anything, which is the trust boundary in .claude/rules/01 about client
 * input.
 *
 * The word in code and copy is "interviewer". docs/00 already uses "persona"
 * for a learner's roadmap persona, and one noun per concept is the writing
 * rule.
 */
import { db } from "../db/pool.ts";

/** The nine, in the order the interviewers page and the picker list them. */
export const INTERVIEWER_SLUGS = [
  "engineering-lead", "cto", "ceo", "solution-architect", "senior-ai-engineer",
  "hiring-manager", "client", "panel", "bar-raiser",
] as const;

export type InterviewerSlug = (typeof INTERVIEWER_SLUGS)[number];

/** The slug of the one interviewer who is three people. */
export const PANEL = "panel";

/**
 * The Amazon Polly voices an interviewer may speak with, each with its
 * language tag. Verified on 30 September 2026 against the Amazon Polly
 * available voices table: every one is offered on the neural engine. Checked
 * again on 8 October 2026 against @aws-sdk/client-polly 3.1132.0, whose
 * VoiceId and LanguageCode types carry every name and tag below.
 */
export const POLLY_VOICES: Readonly<Record<string, string>> = {
  Danielle: "en-US", Gregory: "en-US", Joanna: "en-US", Kendra: "en-US", Kimberly: "en-US",
  Salli: "en-US", Joey: "en-US", Matthew: "en-US", Ruth: "en-US", Stephen: "en-US",
  Amy: "en-GB", Emma: "en-GB", Brian: "en-GB", Arthur: "en-GB",
  Kajal: "en-IN",
  Olivia: "en-AU",
  Niamh: "en-IE",
  Aria: "en-NZ",
  Jasmine: "en-SG",
  Ayanda: "en-ZA",
};

/** The kinds of follow-up round a cadence names. docs/07 section 5a. */
export const CADENCE_KINDS = ["why", "stress", "resume"] as const;
export type CadenceKind = (typeof CADENCE_KINDS)[number];

export type Voice = { id: string; engine: string; language: string };

export type Interviewer = {
  slug: string;
  name: string;
  /** One sentence: a role at a company of a named scale. */
  role: string;
  /** The short label: "engineering lead", "CTO". interviewerTitle(). */
  title: string;
  listensFor: string[];
  openingLine: string;
  followUpStyle: string;
  stressProbes: string[];
  cadence: CadenceKind[];
  /** Null on the panel, which speaks with its chair's voice. */
  voice: Voice | null;
  /** The panel's members, chair first. Empty for a person. */
  members: string[];
  retired: boolean;
};

export class InterviewerNotFound extends Error {
  readonly status = 404;
}

type Row = {
  slug: string; name: string; role_line: string; listens_for: string[]; opening_line: string;
  follow_up_style: string; stress_probes: string[]; cadence: string[]; voice_id: string | null;
  voice_engine: string; voice_language: string | null; members: string[];
  retired_at: Date | null;
};

const COLUMNS = `slug, name, role_line, listens_for, opening_line, follow_up_style, stress_probes,
  cadence, voice_id, voice_engine, voice_language, members, retired_at`;

function fromRow(row: Row): Interviewer {
  return {
    slug: row.slug,
    name: row.name,
    role: row.role_line,
    title: interviewerTitle(row.slug, row.role_line),
    listensFor: row.listens_for,
    openingLine: row.opening_line,
    followUpStyle: row.follow_up_style,
    stressProbes: row.stress_probes,
    cadence: row.cadence.filter((kind): kind is CadenceKind =>
      (CADENCE_KINDS as readonly string[]).includes(kind)),
    voice: row.voice_id
      ? { id: row.voice_id, engine: row.voice_engine,
          language: row.voice_language ?? POLLY_VOICES[row.voice_id] ?? "en-US" }
      : null,
    members: row.members,
    retired: row.retired_at !== null,
  };
}

/**
 * What each interviewer is, as a short lower-case noun phrase that reads
 * inside a sentence: "Asked by Meera Krishnan, CEO." and the room's label,
 * "Priya Raghunathan, engineering lead, at the interview table". It names the
 * seat the learner chose on the picker, which is what they recognise, rather
 * than the role sentence, which carries the company.
 */
const TITLES: Readonly<Record<InterviewerSlug, string>> = {
  "engineering-lead": "engineering lead",
  "cto": "CTO",
  "ceo": "CEO",
  "solution-architect": "solution architect",
  "senior-ai-engineer": "senior AI engineer",
  "hiring-manager": "hiring manager",
  "client": "client",
  "panel": "panel",
  "bar-raiser": "bar raiser",
};

/** The short label for an interviewer. Every label on screen comes from here. */
export function interviewerTitle(slug: string, role: string): string {
  return (TITLES as Readonly<Record<string, string>>)[slug] ?? shortRole(role);
}

/**
 * The role line without its company, lower case at the front, for a slug
 * outside the nine, such as a row from a later file this build has no label
 * for. Cut at the first place the role turns to the employer.
 */
export function shortRole(role: string): string {
  const cut = [" at ", " for ", " from ", " of a ", " of an "]
    .map((marker) => role.indexOf(marker))
    .filter((at) => at > 0)
    .reduce((first, at) => Math.min(first, at), role.length);
  const head = role.slice(0, cut).replace(/[.,]$/, "").trim();
  return head.charAt(0).toLowerCase() + head.slice(1);
}

function order(slug: string): number {
  const at = (INTERVIEWER_SLUGS as readonly string[]).indexOf(slug);
  return at === -1 ? INTERVIEWER_SLUGS.length : at;
}

/** Every published interviewer, in INTERVIEWER_SLUGS order. Retired ones are
 *  left out: they can be read for an old session and chosen for no new one. */
export async function loadInterviewers(): Promise<Interviewer[]> {
  const { rows } = await db().query<Row>(
    `select ${COLUMNS} from voice_interviewer where is_published and retired_at is null`);
  return rows.map(fromRow).sort((a, b) => order(a.slug) - order(b.slug));
}

/**
 * The published interviewer a slug names, for a new session, or
 * InterviewerNotFound. A retired interviewer is refused here: the file that
 * defined them is gone, and a session should not open on a voice and a set of
 * probes nobody maintains.
 */
export async function resolveInterviewer(slug: string): Promise<Interviewer> {
  const { rows } = await db().query<Row>(
    `select ${COLUMNS} from voice_interviewer
      where slug = $1 and is_published and retired_at is null`, [slug]);
  if (!rows[0]) throw new InterviewerNotFound(`No interviewer "${slug}".`);
  return fromRow(rows[0]);
}

/**
 * The interviewer the lobby shows: the one the link chose when it is
 * published, else the first of the question's that is, else null. A link
 * naming an interviewer who is gone is a stale link, so the lobby falls back
 * rather than refusing; the session route still refuses the slug if it is sent.
 */
export function lobbyInterviewer(
  published: readonly Interviewer[], chosen: string | null | undefined,
  candidates: readonly string[],
): Interviewer | null {
  return [chosen, ...candidates]
    .map((slug) => published.find((interviewer) => interviewer.slug === slug))
    .find((interviewer): interviewer is Interviewer => interviewer !== undefined) ?? null;
}

/**
 * The interviewer an existing session names, retired or not, or null. A past
 * session's debrief keeps saying who asked, after the file is gone.
 */
export async function interviewerOnRecord(slug: string | null): Promise<Interviewer | null> {
  if (!slug) return null;
  const { rows } = await db().query<Row>(
    `select ${COLUMNS} from voice_interviewer where slug = $1`, [slug]);
  return rows[0] ? fromRow(rows[0]) : null;
}

/** The panel's members, chair first, as the panel file orders them. A person
 *  has no members and gets an empty list. A member retired since the panel
 *  was written is still returned, because the panel names them. */
export async function membersOf(panel: Interviewer): Promise<Interviewer[]> {
  if (panel.members.length === 0) return [];
  const { rows } = await db().query<Row>(
    `select ${COLUMNS} from voice_interviewer where slug = any($1::text[])`, [panel.members]);
  const found = rows.map(fromRow);
  return panel.members
    .map((slug) => found.find((member) => member.slug === slug))
    .filter((member): member is Interviewer => member !== undefined);
}

/** The voice an interviewer speaks with: their own, or on the panel the
 *  chair's. Null only for a panel whose chair cannot be found. */
export async function speakingVoice(interviewer: Interviewer): Promise<Voice | null> {
  if (interviewer.voice) return interviewer.voice;
  const [chair] = await membersOf(interviewer);
  return chair?.voice ?? null;
}

/** What a debrief, a past answers row and the room need to name who asked. */
export type InterviewerLabel = { slug: string; name: string; role: string; title: string };

export function labelOf(interviewer: Interviewer): InterviewerLabel {
  return { slug: interviewer.slug, name: interviewer.name, role: interviewer.role,
           title: interviewer.title };
}
