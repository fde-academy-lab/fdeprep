/**
 * Python in a brief, a contract or a walkthrough takes the editor's syntax
 * colours, with no new dependency: the grammar is the editor's own. One list
 * in lib/ui/syntax.ts names every colour, so the two cannot drift apart.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "../components/ui/markdown.tsx";
import { SYNTAX, highlightPython } from "../lib/ui/syntax.ts";

describe("highlightPython", () => {
  it("colours a signature the way the editor does", () => {
    const lines = highlightPython("def run_agent(question: str) -> str:\n    return question")!;
    expect(lines).toHaveLength(2);
    const classOf = (text: string) => lines.flat().find((t) => t.text === text)?.className;
    expect(classOf("def")).toBe("syn-keyword");
    expect(classOf("return")).toBe("syn-keyword");
    expect(classOf("run_agent")).toBe("syn-definition");
    expect(lines.flat().map((t) => t.text).join("")).toBe(
      "def run_agent(question: str) -> str:    return question");
  });

  it("returns null for a block that is not Python, so it renders plain", () => {
    expect(highlightPython("Return every problem in one rejection, before the call")).toBeNull();
    expect(highlightPython("Action: <tool>(<key>=<value>, ...)")).toBeNull();
  });

  it("colours an indented Python block in Markdown and leaves prose blocks plain", () => {
    const python = renderToStaticMarkup(createElement(Markdown, {
      source: "Implement:\n\n    def run_agent(question: str) -> str\n" }));
    expect(python).toContain('<span class="syn-keyword">def</span>');
    const prose = renderToStaticMarkup(createElement(Markdown, {
      source: "Shape:\n\n    Action: <tool>(<key>=<value>, ...)\n" }));
    expect(prose).not.toContain("syn-");
    expect(prose).toContain("Action: &lt;tool&gt;(&lt;key&gt;=&lt;value&gt;, ...)");
  });
});

describe("one set of colours", () => {
  it("defines a colour and a class in the stylesheet for every name the list uses", async () => {
    const css = await readFile(path.join(import.meta.dirname, "..", "app", "globals.css"), "utf8");
    for (const { name } of SYNTAX) {
      expect(css).toContain(`--syntax-${name}:`);
      expect(css).toContain(`.syn-${name} { color: var(--syntax-${name}); `.trimEnd());
    }
  });

  it("builds the editor's highlight style from the same list", async () => {
    const theme = await readFile(
      path.join(import.meta.dirname, "..", "components", "workspace", "editor-theme.ts"), "utf8");
    expect(theme).toContain("HighlightStyle.define(SYNTAX.map(");
    expect(theme).not.toMatch(/color: "#[0-9A-Fa-f]{6}"/);
  });
});
