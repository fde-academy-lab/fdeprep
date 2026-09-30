/**
 * The editor's look, built on the design tokens rather than a stock theme, so
 * the editor reads as part of the workspace instead of a window into another
 * product. Syntax colours are content, like diagram tones: they live inside
 * the editor and nowhere else.
 */
import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

const base = EditorView.theme({
  "&": {
    color: "var(--color-text)",
    backgroundColor: "var(--color-bg)",
    fontSize: "13px",
    height: "100%",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    lineHeight: "1.65",
  },
  ".cm-content": { caretColor: "var(--color-accent)", padding: "12px 0" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--color-accent)", borderLeftWidth: "2px" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "rgb(110 151 242 / 0.22)",
  },
  ".cm-gutters": {
    backgroundColor: "var(--color-bg)",
    color: "var(--color-text-faint)",
    border: "none",
    paddingRight: "4px",
  },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 12px 0 16px", minWidth: "44px" },
  ".cm-activeLine": { backgroundColor: "rgb(255 255 255 / 0.028)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--color-text-dim)" },
  ".cm-foldGutter .cm-gutterElement": { color: "var(--color-text-faint)" },
  ".cm-matchingBracket": {
    backgroundColor: "rgb(110 151 242 / 0.18)",
    outline: "1px solid rgb(110 151 242 / 0.4)",
  },
  ".cm-searchMatch": { backgroundColor: "rgb(217 164 65 / 0.25)" },
  "&.cm-focused": { outline: "none" },
}, { dark: true });

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.definitionKeyword, t.moduleKeyword],
    color: "#C49BFF" },
  { tag: [t.string, t.special(t.string)], color: "#8FD49A" },
  { tag: [t.number, t.bool, t.null, t.atom], color: "#F2B36B" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "#6F7885", fontStyle: "italic" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "#7FB2FF" },
  { tag: [t.definition(t.variableName), t.definition(t.function(t.variableName))], color: "#ECEEF2" },
  { tag: [t.className, t.typeName], color: "#6FD3CC" },
  { tag: [t.propertyName], color: "#B8C4D6" },
  { tag: [t.operator, t.punctuation, t.bracket], color: "#A0A7B2" },
  { tag: [t.self, t.special(t.variableName)], color: "#F28FB8" },
  { tag: t.invalid, color: "#F26B63" },
]);

export const editorTheme = [base, syntaxHighlighting(highlight)];

/**
 * Keep writing assistants out of the editor. The learner is the one being
 * assessed, which is why the editor has no autocomplete, and Grammarly attaches
 * itself to any contenteditable element, which CodeMirror's content is. These
 * are the three attributes editor vendors document for turning it off.
 * Grammarly publishes no contract for them, so this is a best effort.
 */
export const noWritingAssistant = EditorView.contentAttributes.of({
  "data-gramm": "false",
  "data-gramm_editor": "false",
  "data-enable-grammarly": "false",
});
