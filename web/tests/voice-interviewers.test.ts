/**
 * The nine interviewers and the gate that checks them. docs/07 section 2a.
 *
 * Two halves, as for the questions. The authored files have to validate, name
 * the nine, speak in nine distinct voices from the verified list and each be
 * named by at least two questions. The validator has to refuse what it exists
 * to refuse, because a gate that only ever passes tests nothing.
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  INTERVIEWER_SLUGS, POLLY_VOICES, interviewerTitle, shortRole,
} from "../lib/voice/interviewers.ts";
import { validateInterviewerYaml } from "../lib/voice/validate-interviewer.ts";

const REPO = path.join(import.meta.dirname, "..", "..");
const DIR = path.join(REPO, "voice-interviewers");
const QUESTIONS = path.join(REPO, "voice-questions");

type File = {
  slug: string; name: string; role: string; members?: string[]; stress_probes: string[];
  voice?: { id: string; engine: string; language: string };
};

async function interviewers() {
  const names = (await readdir(DIR)).filter((name) => name.endsWith(".yaml")).sort();
  return Promise.all(names.map(async (name) => {
    const source = await readFile(path.join(DIR, name), "utf8");
    return { name, source, parsed: parse(source) as File };
  }));
}

async function questions(): Promise<Array<{ interviewers?: string[] }>> {
  const found: Array<{ interviewers?: string[] }> = [];
  for (const entry of await readdir(QUESTIONS, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name.endsWith(".yaml")) {
      const dir = entry.parentPath ?? entry.path;
      found.push(parse(await readFile(path.join(dir, entry.name), "utf8")));
    }
  }
  return found;
}

const KNOWN = new Set<string>(INTERVIEWER_SLUGS);

/** A person who passes every rule, edited per test to break exactly one. */
const PERSON = `slug: cto
name: Daniel Okafor
role: Chief technology officer at an online travel agency the size of MakeMyTrip.
listens_for:
  - The failure you have not mentioned yet.
  - Whether your plan survives a bad week.
opening_line: >-
  Daniel Okafor, CTO. I have twenty minutes.
follow_up_style: >-
  Terse and time-boxed.
stress_probes:
  - Which part of that have you run in production?
  - If this is wrong, how long until we know?
cadence: [stress, why, why, stress, why]
voice: {id: Brian, engine: neural, language: en-GB}
`;

const PANEL = `slug: panel
name: The panel
role: A three-person loop at the AI company.
listens_for:
  - Whether one answer holds up from three angles at once.
  - Whether you answer the person who asked.
opening_line: >-
  There are three of us today.
follow_up_style: >-
  The chair asks the question and the others follow up.
stress_probes:
  - Is there anything in that answer you'd like to take back?
  - Can you give us both in one sentence?
cadence: [why, stress, why, resume, why]
members: [hiring-manager, senior-ai-engineer, client]
`;

const rules = (source: string, file = "cto.yaml") =>
  validateInterviewerYaml(source, file, { known: KNOWN }).errors.map((error) => error.rule);

describe("the authored interviewers", () => {
  it("validates every file", async () => {
    for (const { name, source } of await interviewers()) {
      const report = validateInterviewerYaml(source, name, { known: KNOWN });
      expect(report.errors, name).toEqual([]);
    }
  });

  it("has exactly nine, one per slug", async () => {
    const slugs = (await interviewers()).map(({ parsed }) => parsed.slug).sort();
    expect(slugs).toEqual([...INTERVIEWER_SLUGS].sort());
  });

  it("gives every person a distinct voice from the verified list, in that voice's language", async () => {
    const people = (await interviewers()).filter(({ parsed }) => parsed.slug !== "panel");
    const voices = people.map(({ parsed }) => parsed.voice!.id);
    expect(new Set(voices).size).toBe(people.length);
    for (const { parsed } of people) {
      expect(POLLY_VOICES[parsed.voice!.id], parsed.slug).toBe(parsed.voice!.language);
      expect(parsed.voice!.engine).toBe("neural");
    }
  });

  it("seats three on the panel, chair first, every one of them an interviewer", async () => {
    const panel = (await interviewers()).find(({ parsed }) => parsed.slug === "panel")!.parsed;
    expect(panel.members).toEqual(["hiring-manager", "senior-ai-engineer", "client"]);
    expect(panel.voice).toBeUndefined();
    for (const member of panel.members!) expect(KNOWN.has(member)).toBe(true);
  });

  it("has every interviewer named by at least two questions", async () => {
    const counts = new Map<string, number>();
    for (const question of await questions()) {
      for (const slug of question.interviewers ?? []) counts.set(slug, (counts.get(slug) ?? 0) + 1);
    }
    for (const slug of INTERVIEWER_SLUGS) {
      expect(counts.get(slug) ?? 0, slug).toBeGreaterThanOrEqual(2);
    }
  });

  it("gives every interviewer a short label that reads inside a sentence", async () => {
    // The room's label is "NAME, TITLE, at the interview table", and the
    // debrief says "Asked by NAME, TITLE."
    const titles = Object.fromEntries((await interviewers())
      .map(({ parsed }) => [parsed.slug, interviewerTitle(parsed.slug, parsed.role)]));
    expect(titles).toEqual({
      "engineering-lead": "engineering lead", "cto": "CTO", "ceo": "CEO",
      "solution-architect": "solution architect", "senior-ai-engineer": "senior AI engineer",
      "hiring-manager": "hiring manager", "client": "client", "panel": "panel",
      "bar-raiser": "bar raiser",
    });
  });

  it("falls back to the role sentence cut at its company, for a slug outside the nine", () => {
    expect(interviewerTitle("product-lead",
      "Product lead at a grocery app the size of Zepto, who owns the roadmap."))
      .toBe("product lead");
    expect(shortRole("Head of forward deployed engineering at an AI company the size of Sarvam."))
      .toBe("head of forward deployed engineering");
  });
});

describe("the interviewer validator", () => {
  it("accepts the good person and the good panel", () => {
    expect(rules(PERSON)).toEqual([]);
    expect(rules(PANEL, "panel.yaml")).toEqual([]);
  });

  it("refuses a tenth slug", () => {
    const tenth = PERSON.replace("slug: cto", "slug: product-manager");
    expect(rules(tenth, "product-manager.yaml")).toContain("slug");
  });

  it("refuses a slug that does not match its file", () => {
    expect(rules(PERSON, "ceo.yaml")).toContain("schema");
  });

  it("refuses a fourth probe", () => {
    const four = PERSON.replace(
      "  - If this is wrong, how long until we know?\n",
      "  - If this is wrong, how long until we know?\n  - Who finds out first?\n" +
      "  - What would you cut?\n");
    expect(rules(four)).toContain("stress_probes");
  });

  it("refuses a probe cut short", () => {
    expect(rules(PERSON.replace("run in production?", "run in production"))).toContain("stress_probes");
  });

  it("refuses a four-entry cadence and a kind it does not know", () => {
    expect(rules(PERSON.replace("[stress, why, why, stress, why]", "[stress, why, why, stress]")))
      .toContain("cadence");
    expect(rules(PERSON.replace("[stress, why, why, stress, why]", "[stress, why, how, stress, why]")))
      .toContain("cadence");
  });

  it("refuses a voice off the list, an engine other than neural and the wrong language", () => {
    expect(rules(PERSON.replace("id: Brian", "id: Hal"))).toContain("voice");
    expect(rules(PERSON.replace("engine: neural", "engine: standard"))).toContain("voice");
    expect(rules(PERSON.replace("language: en-GB", "language: en-US"))).toContain("voice");
  });

  it("refuses a person with no voice", () => {
    expect(rules(PERSON.replace(/voice: .*\n/, ""))).toContain("voice");
  });

  it("refuses a panel with a voice of its own", () => {
    const voiced = `${PANEL}voice: {id: Matthew, engine: neural, language: en-US}\n`;
    expect(rules(voiced, "panel.yaml")).toContain("voice");
  });

  it("refuses a person with members", () => {
    expect(rules(`${PERSON}members: [client, ceo]\n`)).toContain("members");
  });

  it("refuses a panel of one, a panel naming itself, and a member nobody wrote", () => {
    expect(rules(PANEL.replace("[hiring-manager, senior-ai-engineer, client]", "[client]"), "panel.yaml"))
      .toContain("members");
    expect(rules(PANEL.replace("[hiring-manager, senior-ai-engineer, client]", "[panel, client]"),
                 "panel.yaml")).toContain("members");
    expect(rules(PANEL.replace("client]", "an-intern]"), "panel.yaml")).toContain("members");
  });

  it("refuses an em dash in an opening line, and a word the writing rules ban", () => {
    expect(rules(PERSON.replace("I have twenty minutes.", "I have twenty minutes \u2014 go.")))
      .toContain("prose_dash");
    // Joined here so a search for the word finds content, not this test.
    expect(rules(PERSON.replace("Terse and time-boxed.", `Terse, and a ${"piv" + "otal"} voice.`)))
      .toContain("banned_word");
  });

  it("refuses a file missing a field the generator needs", () => {
    expect(rules(PERSON.replace(/follow_up_style: >-\n  .*\n/, ""))).toContain("schema");
  });
});
