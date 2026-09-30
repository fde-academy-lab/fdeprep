/**
 * Names in code render as code in the fields that were never Markdown: the
 * scenario card, the diagram, the approach map, the coach, the steps and the
 * labels. The first beta tester found function names lost in the prose.
 */
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { renderCode, withoutCodeMarks } from "../components/ui/code.tsx";
import { answerOutline } from "../lib/problems/outline.ts";

const html = (text: string) => renderToStaticMarkup(createElement(Fragment, null, renderCode(text)));

describe("renderCode", () => {
  it("renders a backticked name as code and leaves the words around it", () => {
    const out = html("The loop crashed on `delete_account` twice.");
    expect(out).toMatch(/^The loop crashed on <code class="[^"]*font-mono[^"]*">delete_account<\/code> twice\.$/);
  });

  it("renders a call with its arguments as one span", () => {
    expect(html("Call `tools[name](**args)` once")).toContain(">tools[name](**args)</code>");
  });

  it("leaves asterisks and underscores as the author typed them", () => {
    expect(html("5 * 3 and a_b")).toBe("5 * 3 and a_b");
  });

  it("returns plain text untouched", () => {
    expect(html("No names here.")).toBe("No names here.");
  });
});

describe("withoutCodeMarks", () => {
  it("drops the backticks for a place that cannot render code", () => {
    expect(withoutCodeMarks("Where `approve()` meets `payout()`")).toBe("Where approve() meets payout()");
  });

  it("keeps an approach label readable as a heading in a design answer's outline", () => {
    const outline = answerOutline({
      requiredHeadings: [],
      approach: { goal: "g", branches: [{ label: "Guard `account_api`", detail: "", leaves: [] }] },
    } as never);
    expect(outline).toBe("## Guard account_api\n");
  });
});
