/**
 * The three rules docs/07 says are the ones most likely to be built wrong by
 * default, checked three different ways because none of them alone is proof.
 *
 * 1. No transcript text on screen during an answer, in any mode. Checked
 *    structurally: transcript text may only ever be written into a ref, and a
 *    ref is not a rendering surface.
 * 2. No model call while the learner is speaking. Checked by running a whole
 *    answer with fetch replaced by something that throws.
 * 3. One nudge at a time, never inside twenty seconds of the last. Checked in
 *    cues.test.ts for the timing and here for the slot, which takes one line
 *    and cannot hold two.
 *
 * A browser run against a real microphone is in the pull request body. These
 * are the parts that can fail in CI on someone else's change.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { CockpitRun } from "@/lib/voice/run";
import { MAX_WORDS, wordCount } from "@/lib/voice/nudges";
import type { Beat } from "@/lib/voice/cues";

const APP = path.join(import.meta.dirname, "..", "app", "voice", "session");
const LIB = path.join(import.meta.dirname, "..", "lib", "voice");

const read = (file: string) => readFile(file, "utf8");

const BEATS: Beat[] = [
  { key: "b1", label: "Name the risk", seconds: 30, ordinal: 1, anchors: ["loop", "runaway"] },
  { key: "b2", label: "Name the mechanism", seconds: 60, ordinal: 2, anchors: ["step budget"] },
  { key: "b3", label: "What happens when it fires", seconds: 60, ordinal: 3, anchors: ["degrade"] },
  { key: "b4", label: "The case it misses", seconds: 75, ordinal: 4, anchors: ["same tool"] },
  { key: "b5", label: "What you would monitor", seconds: 60, ordinal: 5, anchors: ["alert"] },
];

describe("no transcript text reaches the screen", () => {
  /**
   * The cockpit keeps partial and final text in a ref. React cannot render a
   * ref, so putting a transcript on screen would need an edit that moved it
   * into state or into JSX. This looks for exactly that edit.
   */
  test("transcript text is only ever written into a ref", async () => {
    const source = await read(path.join(APP, "cockpit.tsx"));
    const lines = source.split("\n");

    const offenders = lines.filter((line, index) => {
      // Reads of the two places transcript text lives.
      if (!/message\.text|transcript\.current/.test(line)) return false;
      // Comments explaining the rule are not uses of it.
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return false;
      // Allowed: assigning into the ref, and passing it to the cue engine or
      // to the server at the end, neither of which renders.
      const allowed =
        /transcript\.current\.\w+\s*(=|\.push\()/.test(line) ||
        /partialTranscript:/.test(line) ||
        /transcript:\s*transcript\.current/.test(line);
      if (allowed) return false;
      // Anything else is a use worth reading, unless it is plainly a ref
      // declaration.
      return !/const transcript = useRef/.test(line) && !/\}\s*=\s*transcript/.test(line);
    });

    expect(
      offenders,
      `transcript text is used outside a ref on these lines:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  test("the cockpit holds no state that could carry a transcript", async () => {
    const source = await read(path.join(APP, "cockpit.tsx"));
    const setters = [...source.matchAll(/setNote|setAnnouncement|setNudgeLine/g)];
    expect(setters.length).toBeGreaterThan(0);

    // Every call to a string-valued setter, and what it was given. None may
    // be transcript text.
    for (const match of source.matchAll(/set(Note|Announcement|NudgeLine)\(([^;]*)\)/g)) {
      expect(match[2], `set${match[1]} was given ${match[2]}`).not.toMatch(
        /transcript\.current|message\.text/,
      );
    }
  });

  test("the instruments render beats, anchors and nudges and never a transcript", async () => {
    const source = await read(path.join(APP, "instruments.tsx"));
    expect(source).not.toMatch(/transcript/i);
  });

  /** docs/07 section 3 also forbids the word count, a score preview, the
   *  rubric and a running nudge total. */
  test("nothing the cockpit deliberately hides has crept in", async () => {
    const source = await read(path.join(APP, "instruments.tsx"));
    for (const forbidden of [/word count/i, /score/i, /rubric/i, /nudges so far/i]) {
      expect(source, `${forbidden} appears in the instruments`).not.toMatch(forbidden);
    }
  });
});

describe("no model call while the learner is speaking", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * The answer window is from the first frame to the stop. Across it the
   * cockpit runs the cue engine on partials and nothing else, so a fetch of
   * any kind is a failure whatever it was going to ask for.
   */
  test("a whole answer runs with zero calls out", () => {
    const calls: string[] = [];
    const refuse = (...args: unknown[]) => {
      calls.push(String(args[0]));
      throw new Error("the cockpit called out during an answer");
    };
    vi.stubGlobal("fetch", refuse);
    vi.stubGlobal("XMLHttpRequest", function XHR() {
      refuse("XMLHttpRequest");
    });

    const cockpit = new CockpitRun(BEATS, 285, true);
    for (let at = 100; at <= 285_000; at += 100) {
      cockpit.advanceTo({
        elapsedMs: at,
        partialTranscript: at > 30_000 ? "a loop with a step budget that can degrade" : "",
        voiced: at % 7_000 !== 0,
      });
    }

    expect(calls).toEqual([]);
    expect(cockpit.recordedNudges.length).toBeGreaterThan(0);
  });

  test("the engine imports nothing that could reach a network", async () => {
    for (const file of ["cues.ts", "nudges.ts", "run.ts"]) {
      const source = await read(path.join(LIB, file));
      expect(source, `${file} fetches`).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|aws-sdk/);
      // Imports are relative siblings only: nothing from a package, so
      // nothing that could open a socket.
      for (const match of source.matchAll(/from "([^"]+)"/g)) {
        expect(match[1], `${file} imports ${match[1]}`).toMatch(/^\.\//);
      }
    }
  });
});

describe("the nudge slot", () => {
  test("it takes one line and has nowhere to put a second", async () => {
    const source = await read(path.join(APP, "instruments.tsx"));
    expect(source).toMatch(/function NudgeSlot\(\{ line \}: \{ line: string \| null \}\)/);
    expect(source, "the slot maps over something, so it can stack").not.toMatch(
      /NudgeSlot[\s\S]{0,400}\.map\(/,
    );
  });

  test("the slot keeps its height when empty, so nothing reflows mid-answer", async () => {
    const source = await read(path.join(APP, "instruments.tsx"));
    expect(source).toMatch(/function NudgeSlot[\s\S]{0,300}h-6/);
  });

  test("every line the engine can produce fits in nine words", () => {
    const cockpit = new CockpitRun(BEATS, 285, true);
    for (let at = 100; at <= 285_000; at += 100) {
      cockpit.advanceTo({
        elapsedMs: at,
        partialTranscript: at > 100_000 ? "we would degrade" : "",
        voiced: at % 9_000 !== 0,
      });
    }
    const kinds = new Set(cockpit.recordedNudges.map((n) => n.kind));
    expect(kinds.size).toBeGreaterThan(1);
    for (const nudge of cockpit.recordedNudges) {
      expect(wordCount(nudge.line), nudge.line).toBeLessThanOrEqual(MAX_WORDS);
    }
  });
});

/** docs/07 section 3: five live instruments, and nothing else. */
describe("the cockpit shows five instruments", () => {
  test("the instruments module exports exactly the five, plus the announcer", async () => {
    const source = await read(path.join(APP, "instruments.tsx"));
    // Components only: a capital first letter is what React renders. `clock`
    // is a helper the cockpit formats with and draws nothing.
    const exported = [...source.matchAll(/export function ([A-Z]\w+)/g)].map((m) => m[1]);
    expect(exported.sort()).toEqual([
      "Announcer", "BeatTrack", "MicLevel", "NudgeSlot", "PaceBand", "Territory",
    ]);
  });

  test("the pace band changes colour with no transition", async () => {
    const source = await read(path.join(APP, "instruments.tsx"));
    expect(source).toMatch(/function PaceBand[\s\S]{0,600}transition: "none"/);
  });

  test("state colour is used by the pace band alone", async () => {
    const source = await read(path.join(APP, "instruments.tsx"));
    const blocks = source.split(/export function /).slice(1);
    for (const block of blocks) {
      const name = block.slice(0, block.indexOf("("));
      if (name === "PaceBand") continue;
      // PACE_TONE holds the three state colours and lives above the exports.
      expect(block, `${name} uses a state colour`).not.toMatch(
        /text-(pass|warn|fail)|border-(pass|warn|fail)/,
      );
    }
  });
});

/** The cockpit has to work without sight. */
describe("the non-visual cockpit", () => {
  test("every instrument carries a name and a state a screen reader can read", async () => {
    const source = await read(path.join(APP, "instruments.tsx"));
    expect(source).toMatch(/aria-label="Beat track"/);
    expect(source).toMatch(/aria-label=\{`Pace \$\{PACE_WORD\[state\]\}/);
    expect(source).toMatch(/role="meter"/);
    expect(source).toMatch(/function NudgeSlot[\s\S]{0,300}aria-live="assertive"/);
    expect(source).toMatch(/function Announcer[\s\S]{0,300}aria-live="polite"/);
  });

  test("each beat says its label and its state, not just a coloured bar", async () => {
    const source = await read(path.join(APP, "instruments.tsx"));
    expect(source).toMatch(/beat\.covered \? "covered" : current \? "current" : "not reached"/);
    expect(source).toMatch(/sr-only[\s\S]{0,200}\{beat\.label\}/);
  });

  test("the pace band is a word before it is a colour", async () => {
    const source = await read(path.join(APP, "instruments.tsx"));
    // The three words render as text, so the state survives a monochrome
    // screen, a colour-blind reader and a screen reader alike.
    expect(source).toMatch(/\{PACE_WORD\[state\]\}/);
  });

  test("the announcer is told about beats and nudges and nothing else", async () => {
    const source = await read(path.join(APP, "cockpit.tsx"));
    for (const match of source.matchAll(/setAnnouncement\(([^;]*)\)/g)) {
      expect(match[1]).toMatch(/Beat |nudge\.line|Interruption|Back to the answer|covered/);
    }
  });
});

/** docs/07 section 5. */
describe("pressure mode", () => {
  test("two interruptions is the ceiling and the clock stops for them", async () => {
    const source = await read(path.join(APP, "cockpit.tsx"));
    expect(source).toMatch(/MAX_INTERRUPTIONS = 2/);
    expect(source).toMatch(/INTERRUPTION_SECONDS = 60/);
    // The answer clock subtracts every paused interval, so the remaining time
    // is unchanged by an interruption.
    expect(source).toMatch(/Date\.now\(\) - startedAt\.current - pausedMs\.current - paused/);
  });

  test("follow-ups come from the authored bank and fire after a beat", async () => {
    const source = await read(path.join(APP, "cockpit.tsx"));
    expect(source).toMatch(/question\.followUps\.find/);
    expect(source).toMatch(/covered\.includes\(followUp\.triggerAfterBeat\)/);
    // No model generates one. docs/07 section 5 calls that a later addition.
    expect(source).not.toMatch(/bedrock|generate|completion/i);
  });
});

/** docs/07 section 12, item 9: a session abandoned mid-answer saves what it
 *  heard. A fetch during unload is cancelled by the browser, so this has to
 *  be sendBeacon and nothing else. */
describe("an abandoned session", () => {
  test("the timeline is beaconed on pagehide, not fetched", async () => {
    const source = await read(path.join(APP, "cockpit.tsx"));
    expect(source).toMatch(/navigator\.sendBeacon/);
    expect(source).toMatch(/addEventListener\("pagehide"/);
    // The beacon carries the same two things the stop button sends.
    expect(source).toMatch(/sendBeacon[\s\S]{0,200}finish/);
  });

  test("the nudge slot clears rather than holding a stale line", async () => {
    const source = await read(path.join(APP, "cockpit.tsx"));
    expect(source).toMatch(/NUDGE_LIFETIME_MS/);
    expect(source).toMatch(/at - nudgeShownAt\.current >= NUDGE_LIFETIME_MS/);
  });
});
