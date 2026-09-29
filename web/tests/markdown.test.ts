/**
 * The markdown renderer every brief, contract, hint and walkthrough goes
 * through. Before it existed a brief rendered as raw text, so a YAML block
 * wrapped at 78 columns broke mid-sentence on screen and backticks showed.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown, parseBlocks } from "../components/ui/markdown.tsx";

const html = (source: string) => renderToStaticMarkup(createElement(Markdown, { source }));

describe("blocks", () => {
  it("joins hard-wrapped lines into one paragraph", () => {
    const blocks = parseBlocks("A shipping-status tool answers with HTTP 200\neven when it\nfails.\n\nSecond.");
    expect(blocks.map((b) => b.kind)).toEqual(["p", "p"]);
    expect(html("one\ntwo")).toBe(
      '<div class="min-w-0 text-body leading-[1.65] text-text"><p class="mt-3 first:mt-0">one two</p></div>');
  });

  it("reads an indented block as code, which is how contracts show a signature", () => {
    const blocks = parseBlocks("Implement:\n\n    def run_agent(question: str, llm, tools: dict) -> str\n\nThen.");
    expect(blocks[1]).toEqual({
      kind: "code", lang: "", text: "def run_agent(question: str, llm, tools: dict) -> str",
    });
  });

  it("keeps a fenced block verbatim, blank lines included", () => {
    const blocks = parseBlocks("```python\nx = 1\n\ny = 2\n```");
    expect(blocks).toEqual([{ kind: "code", lang: "python", text: "x = 1\n\ny = 2" }]);
  });

  it("folds a list item's continuation line into the item", () => {
    const blocks = parseBlocks("- first item\n  runs on\n- second\n\nAfter.");
    expect(blocks[0]).toEqual({
      kind: "list", ordered: false, start: 1, items: ["first item\nruns on", "second"],
    });
    expect(blocks[1]).toEqual({ kind: "p", text: "After." });
  });

  it("parses a table with alignment", () => {
    const blocks = parseBlocks("| Case | Result |\n|---|---:|\n| a | 1 |\n| b | 2 |");
    expect(blocks[0]).toEqual({
      kind: "table", head: ["Case", "Result"], align: ["left", "right"],
      rows: [["a", "1"], ["b", "2"]],
    });
  });
});

describe("inline", () => {
  it("renders code, bold, italic and links", () => {
    const out = html("Call `llm(prompt)` **once** and *only* see [docs](https://example.org).");
    expect(out).toContain("<code");
    expect(out).toContain("llm(prompt)</code>");
    expect(out).toContain('<strong class="font-semibold text-text">once</strong>');
    expect(out).toContain("<em>only</em>");
    expect(out).toContain('href="https://example.org"');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it("leaves snake_case identifiers alone", () => {
    expect(html("call run_agent and max_llm_calls")).not.toContain("<em>");
  });
});

describe("what a problem file cannot do", () => {
  it("never passes HTML through", () => {
    const out = html('<script>alert(1)</script> and <img src=x onerror="y">');
    expect(out).not.toContain("<script>");
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;script&gt;");
  });

  it("drops a link whose scheme could run code, and keeps its text", () => {
    const out = html("[click](javascript:alert(1))");
    expect(out).not.toContain("href");
    expect(out).toContain("click");
  });
});
