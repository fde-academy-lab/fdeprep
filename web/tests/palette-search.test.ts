import { describe, expect, it } from "vitest";
import { firstUnsolved, search } from "../lib/ui/palette-search.ts";
import { paletteChapters, palettePages } from "../components/shell/palette-pages.ts";
import { TRACK_NAMES } from "../lib/problems/vocabulary.ts";

const ITEMS = [
  { title: "Retry within a deadline", track: "tool-creation", difficulty: "hard", artefactType: "code" },
  { title: "Dispatch only registered actions", track: "tool-creation", difficulty: "easy", artefactType: "code" },
  { title: "Abstain when evidence is too weak", track: "rag", difficulty: "easy", artefactType: "code" },
  { title: "Set the release threshold", track: "evals", difficulty: "medium", artefactType: "design" },
];

describe("palette search", () => {
  it("returns everything, in catalogue order, for an empty query", () => {
    expect(search(ITEMS, "").map((i) => i.title)).toEqual(ITEMS.map((i) => i.title));
  });

  it("needs every word to match somewhere", () => {
    expect(search(ITEMS, "easy rag").map((i) => i.title)).toEqual(["Abstain when evidence is too weak"]);
    expect(search(ITEMS, "easy design")).toEqual([]);
  });

  it("puts a title that starts with the query first", () => {
    expect(search(ITEMS, "re")[0]!.title).toBe("Retry within a deadline");
  });

  it("finds a problem by its track's words", () => {
    expect(search(ITEMS, "tool creation").map((i) => i.title)).toEqual([
      "Retry within a deadline", "Dispatch only registered actions",
    ]);
  });

  it("caps the list", () => {
    expect(search(ITEMS, "", 2)).toHaveLength(2);
  });
});

describe("palette groups", () => {
  // One name per place: the palette's Go to rows carry the names the header
  // uses, and every chapter sits in the list in the order the stages run.
  it("lists the five sections, and Admin for staff only", () => {
    expect(palettePages("learner").map((p) => p.label))
      .toEqual(["Home", "Problems", "Rehearsal", "Voice", "Progress"]);
    for (const role of ["faculty", "admin"] as const) {
      expect(palettePages(role).map((p) => [p.label, p.href]).at(-1)).toEqual(["Admin", "/admin"]);
      expect(palettePages(role)).toHaveLength(6);
    }
  });

  it("lists the fourteen chapters in stage order, each opening its chapter page", () => {
    const chapters = paletteChapters();
    expect(chapters).toHaveLength(14);
    expect(chapters.map((c) => c.label)).toEqual([
      "Loop engineering", "Tool design", "Harness engineering",
      "Context engineering", "Memory architecture", "Orchestration patterns",
      "Guardrails and permissions", "Human in the loop", "Evals for agents",
      "Observability and tracing",
      "Agentic PDLC", "Agentic SDLC (AI-DLC)", "End-to-end builds", "Client delivery",
    ]);
    for (const chapter of chapters) {
      expect(chapter.label).toBe(TRACK_NAMES[chapter.track]);
      expect(chapter.href).toBe(`/chapters/${chapter.track}`);
    }
  });

  it("files each chapter under its stage, so typing production finds Guardrails and permissions", () => {
    const production = paletteChapters().filter((c) => /production/i.test(c.keywords));
    expect(production.map((c) => c.label)).toEqual([
      "Guardrails and permissions", "Human in the loop", "Evals for agents", "Observability and tracing",
    ]);
  });
});

describe("problems to start with", () => {
  const index = [
    { slug: "a", state: "solved" }, { slug: "b", state: "attempted" },
    { slug: "c", state: "untouched" }, { slug: "d", state: "untouched" },
  ];

  it("skips what is solved and keeps the path's order", () => {
    expect(firstUnsolved(index, 6).map((p) => p.slug)).toEqual(["b", "c", "d"]);
  });

  it("caps the list", () => {
    expect(firstUnsolved(index, 2).map((p) => p.slug)).toEqual(["b", "c"]);
  });
});
