import { describe, expect, it } from "vitest";
import { diffCounts, diffLines } from "../lib/diff.ts";

describe("the line diff behind S5's third editor mode", () => {
  it("marks an untouched text entirely same", () => {
    const lines = diffLines("a\nb\nc", "a\nb\nc");
    expect(lines.map((l) => l.kind)).toEqual(["same", "same", "same"]);
  });

  it("marks a deleted line removed and keeps its original line number", () => {
    const lines = diffLines("a\nb\nc", "a\nc");
    const removed = lines.find((l) => l.kind === "removed")!;
    expect(removed.text).toBe("b");
    expect(removed.originalLine).toBe(2);
    expect(removed.editedLine).toBeNull();
  });

  it("marks an inserted line added and keeps its edited line number", () => {
    const lines = diffLines("a\nc", "a\nb\nc");
    const added = lines.find((l) => l.kind === "added")!;
    expect(added.text).toBe("b");
    expect(added.editedLine).toBe(2);
    expect(added.originalLine).toBeNull();
  });

  it("renders a replaced line as a removal and an addition", () => {
    expect(diffCounts(diffLines("a\nb\nc", "a\nB\nc"))).toEqual({ added: 1, removed: 1 });
  });

  it("reconstructs the edited text from the lines it keeps", () => {
    const original = "one\ntwo\nthree\nfour";
    const edited = "one\ntwo and a half\nfour\nfive";
    const rebuilt = diffLines(original, edited)
      .filter((l) => l.kind !== "removed").map((l) => l.text).join("\n");
    expect(rebuilt).toBe(edited);
  });

  it("handles an empty edit without losing the original", () => {
    expect(diffCounts(diffLines("a\nb", ""))).toEqual({ added: 1, removed: 2 });
  });
});
