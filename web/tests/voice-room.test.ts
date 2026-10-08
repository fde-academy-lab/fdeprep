/**
 * The pixel-art interview room, plan section 4.9.
 *
 * Three things are checked here because a browser cannot check them. The
 * drawing is made only of theme tokens, so it follows the theme and never
 * wears the accent or a state colour (docs/08 section 3: the accent appears
 * at most twice per screen, and a state colour means one thing). The sprites
 * are well formed, so a persona cannot render half a figure. And the cockpit
 * never imports it, because docs/07 section 3 allows five live instruments
 * and a room is not one of them.
 */
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InterviewRoom, type RoomPerson } from "../components/voice/room/room.tsx";
import { InterviewerAvatar } from "../components/voice/room/avatar.tsx";
import { PixelGrid } from "../components/voice/room/pixel.tsx";
import {
  FIGURE_HEIGHT, FIGURE_WIDTH, FIGURES, PALETTE, SCENE, SCENE_HEIGHT, SCENE_WIDTH, SPRITES,
} from "../components/voice/room/sprites.ts";

const COCKPIT = path.join(import.meta.dirname, "..", "app", "(focus)", "voice", "session");

/** Every token the room may paint with. Surfaces, borders, text and the diagram tones. */
const ALLOWED = new Set([
  "bg", "surface", "surface-2", "surface-3", "border", "border-strong",
  "text", "text-dim", "text-faint",
  "tone-blue", "tone-green", "tone-purple", "tone-teal", "tone-orange", "tone-pink", "tone-neutral",
].map((name) => `var(--color-${name})`));

/** The accent and the state colours, by name, so a new token in that family is caught too. */
const FORBIDDEN = /var\(--color-(accent|pass|fail|warn|info)/;

const PEOPLE: Record<string, RoomPerson> = {
  "engineering-lead": { slug: "engineering-lead", name: "Priya Raghunathan", role: "engineering lead" },
  cto: { slug: "cto", name: "Daniel Okafor", role: "CTO" },
  ceo: { slug: "ceo", name: "Meera Krishnan", role: "CEO" },
  "solution-architect": { slug: "solution-architect", name: "Tomasz Nowak", role: "solution architect" },
  "senior-ai-engineer": { slug: "senior-ai-engineer", name: "Aisha Rahman", role: "senior AI engineer" },
  "hiring-manager": { slug: "hiring-manager", name: "Rohan Mehta", role: "hiring manager" },
  client: { slug: "client", name: "Sunita Desai", role: "client" },
  "bar-raiser": { slug: "bar-raiser", name: "Siobhán Byrne", role: "bar raiser" },
};
const SLUGS = Object.keys(PEOPLE);
const PANEL = [PEOPLE["hiring-manager"]!, PEOPLE["senior-ai-engineer"]!, PEOPLE.client!];

const room = (interviewers: RoomPerson[], size: "lobby" | "debrief" = "lobby") =>
  renderToStaticMarkup(createElement(InterviewRoom, { interviewers, size }));
const avatar = (slug: string) => renderToStaticMarkup(createElement(InterviewerAvatar, { slug }));

const fills = (markup: string) => [...markup.matchAll(/fill="([^"]*)"/g)].map((m) => m[1]!);
const rects = (markup: string) => (markup.match(/<rect\b/g) ?? []).length;
const label = (markup: string) => markup.match(/aria-label="([^"]*)"/)?.[1] ?? "";

describe("the sprites", () => {
  it("draws the scene as 48 rows of 80 cells", () => {
    expect(SCENE_WIDTH).toBe(80);
    expect(SCENE_HEIGHT).toBe(48);
    expect(SCENE).toHaveLength(48);
    for (const row of SCENE) expect(row).toHaveLength(80);
  });

  it("draws every figure at the same size, one per persona", () => {
    for (const slug of SLUGS) expect(FIGURES[slug], slug).toBeDefined();
    for (const [slug, rows] of Object.entries(FIGURES)) {
      expect(rows, slug).toHaveLength(FIGURE_HEIGHT);
      for (const row of rows) expect(row, slug).toHaveLength(FIGURE_WIDTH);
    }
  });

  it("names a palette entry for every character in every grid", () => {
    const grids: Record<string, string[]> = { SCENE, ...FIGURES, ...SPRITES };
    for (const [name, rows] of Object.entries(grids)) {
      for (const char of new Set(rows.join(""))) {
        expect(char in PALETTE, `${name} uses ${JSON.stringify(char)}`).toBe(true);
      }
    }
  });

  it("paints only with the theme tokens the room may use", () => {
    for (const [char, token] of Object.entries(PALETTE)) {
      if (token === "") continue;
      expect(ALLOWED.has(token), `${JSON.stringify(char)} maps to ${token}`).toBe(true);
    }
  });
});

describe("InterviewRoom", () => {
  it("is an image that names the interviewer and the table", () => {
    for (const slug of SLUGS) {
      const markup = room([PEOPLE[slug]!]);
      expect(markup).toContain('role="img"');
      expect(label(markup)).toBe(`${PEOPLE[slug]!.name}, ${PEOPLE[slug]!.role}, at the interview table`);
    }
  });

  it("names all three of a panel, chair first", () => {
    const text = label(room(PANEL));
    expect(text).toBe(
      "Rohan Mehta, hiring manager, Aisha Rahman, senior AI engineer and Sunita Desai, client, " +
      "at the interview table");
    for (const person of PANEL) expect(text).toContain(person.name);
  });

  it("fills every cell from the allowed tokens and never the accent or a state colour", () => {
    const renders = [
      ...SLUGS.map((slug) => room([PEOPLE[slug]!])),
      room(PANEL),
      room(PANEL, "debrief"),
      room([PEOPLE.cto!], "debrief"),
      room([]),
      ...SLUGS.map(avatar),
    ];
    for (const markup of renders) {
      const seen = fills(markup);
      expect(seen.length).toBeGreaterThan(0);
      for (const fill of seen) expect(ALLOWED.has(fill), fill).toBe(true);
      expect(markup).not.toMatch(FORBIDDEN);
    }
  });

  it("keeps the DOM small by merging runs of one colour", () => {
    // 80 by 48 is 3,840 cells. A rect per cell would be a tab's worth of DOM
    // for a decoration; a row of merged runs stays in the hundreds.
    for (const markup of [...SLUGS.map((slug) => room([PEOPLE[slug]!])), room(PANEL)]) {
      expect(rects(markup)).toBeLessThan(900);
    }
  });

  it("scales down with the viewport and caps at the stated size", () => {
    const lobby = room([PEOPLE.ceo!]);
    expect(lobby).toContain('viewBox="0 0 80 48"');
    expect(lobby).toContain('shape-rendering="crispEdges"');
    expect(lobby).toMatch(/width="400" height="240"/);
    expect(lobby).toMatch(/max-width:400px/);
    const debrief = room([PEOPLE.ceo!], "debrief");
    expect(debrief).toMatch(/width="240" height="144"/);
    expect(debrief).toMatch(/max-width:240px/);
  });

  it("uses no raster, filter, gradient, animation or script", () => {
    const markup = room(PANEL);
    expect(markup).not.toMatch(/<(image|filter|linearGradient|radialGradient|animate|script|foreignObject)\b/);
    expect(markup).not.toMatch(/data:image/);
  });

  it("renders a neutral figure for a slug it has never seen", () => {
    const markup = room([{ slug: "somebody-new", name: "Somebody New", role: "guest" }]);
    expect(markup).toContain('role="img"');
    expect(label(markup)).toBe("Somebody New, guest, at the interview table");
    expect(rects(markup)).toBeGreaterThan(rects(room([])));
  });

  it("draws each persona as a different figure", () => {
    const markups = new Set(SLUGS.map((slug) => room([PEOPLE[slug]!]).replace(/aria-label="[^"]*"/, "")));
    expect(markups.size).toBe(SLUGS.length);
  });
});

describe("InterviewerAvatar", () => {
  it("is a hidden 24 pixel square", () => {
    for (const slug of [...SLUGS, "somebody-new"]) {
      const markup = avatar(slug);
      expect(markup).toContain('aria-hidden="true"');
      expect(markup).not.toContain('role="img"');
      expect(markup).toContain('viewBox="0 0 12 12"');
      expect(markup).toMatch(/width="24" height="24"/);
    }
  });

  it("differs between personas", () => {
    expect(new Set(SLUGS.map(avatar)).size).toBe(SLUGS.length);
  });
});

describe("PixelGrid", () => {
  it("merges a row of one colour into one rect and skips transparent cells", () => {
    const markup = renderToStaticMarkup(createElement(PixelGrid, {
      rows: ["aaa.", "ab.."],
      palette: { a: "var(--color-bg)", b: "var(--color-text)", ".": "" },
      cell: 5,
    }));
    expect(rects(markup)).toBe(3);
    expect(markup).toContain('x="0" y="0" width="3" height="1" fill="var(--color-bg)"');
    expect(markup).toContain('x="1" y="1" width="1" height="1" fill="var(--color-text)"');
    expect(markup).toContain('viewBox="0 0 4 2"');
    expect(markup).toMatch(/width="20" height="10"/);
  });
});

describe("the cockpit never imports the room", () => {
  // docs/07 section 3: five live instruments and nothing else while the
  // learner speaks. The room is decoration for the lobby and the debrief.
  it("keeps components/voice/room out of cockpit.tsx, instruments.tsx and interview.tsx", async () => {
    // cockpit.tsx has to exist, or a renamed file would pass this for nothing.
    await expect(stat(path.join(COCKPIT, "cockpit.tsx"))).resolves.toBeTruthy();
    let checked = 0;
    for (const file of ["cockpit.tsx", "instruments.tsx", "interview.tsx"]) {
      const source = await readFile(path.join(COCKPIT, file), "utf8").catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT" && file === "interview.tsx") return null;
        throw error;
      });
      if (source === null) continue;
      checked += 1;
      expect(source, file).not.toMatch(/voice\/room/);
    }
    expect(checked).toBeGreaterThanOrEqual(2);
  });
});
