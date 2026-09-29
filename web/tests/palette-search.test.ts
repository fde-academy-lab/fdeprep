import { describe, expect, it } from "vitest";
import { search } from "../lib/ui/palette-search.ts";

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
