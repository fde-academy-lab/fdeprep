/**
 * Syntax colours, defined once for the editor and for code blocks in a brief,
 * a contract or a walkthrough, so Python reads the same in both places.
 *
 * Each rule names a colour; app/globals.css holds the colour as
 * `--syntax-<name>` and the class `syn-<name>` that paints it. The editor's
 * HighlightStyle and the static highlighter below are both built from this
 * list, so they cannot drift apart.
 */
import { pythonLanguage } from "@codemirror/lang-python";
import { highlightCode, tagHighlighter, tags as t, type Tag } from "@lezer/highlight";

export const SYNTAX: ReadonlyArray<{ tag: Tag | Tag[]; name: string; italic?: boolean }> = [
  { tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.definitionKeyword, t.moduleKeyword],
    name: "keyword" },
  { tag: [t.string, t.special(t.string)], name: "string" },
  { tag: [t.number, t.bool, t.null, t.atom], name: "number" },
  { tag: [t.comment, t.lineComment, t.blockComment], name: "comment", italic: true },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], name: "function" },
  { tag: [t.definition(t.variableName), t.definition(t.function(t.variableName))],
    name: "definition" },
  { tag: [t.className, t.typeName], name: "type" },
  { tag: [t.propertyName], name: "property" },
  { tag: [t.operator, t.punctuation, t.bracket], name: "punctuation" },
  { tag: [t.self, t.special(t.variableName)], name: "self" },
  { tag: t.invalid, name: "invalid" },
];

const staticHighlighter = tagHighlighter(
  SYNTAX.map(({ tag, name }) => ({ tag, class: `syn-${name}` })));

export interface Token {
  text: string;
  /** Empty for text with no syntax role, such as spaces and plain names. */
  className: string;
}

/** A contract shows a signature with no body, which does not parse but is still Python. */
const SIGNATURE = /^\s*(?:async\s+def|def|class)\s+\w|^\s*@\w/;

/**
 * Python source as lines of coloured tokens, or null when it is not Python. A
 * block that parses cleanly is Python, and so is one that opens a function or
 * class the way a contract's signature does. Anything else, such as a sentence
 * or a message format, comes back null and renders plain rather than half
 * coloured.
 */
export function highlightPython(code: string): Token[][] | null {
  const tree = pythonLanguage.parser.parse(code);
  let broken = false;
  tree.iterate({ enter: (node) => { if (node.type.isError) broken = true; } });
  if (broken && !SIGNATURE.test(code)) return null;
  const lines: Token[][] = [[]];
  highlightCode(code, tree, staticHighlighter,
                (text, className) => lines[lines.length - 1]!.push({ text, className }),
                () => lines.push([]));
  return lines;
}
