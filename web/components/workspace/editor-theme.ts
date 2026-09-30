/**
 * The editor's look, built on the design tokens rather than a stock theme, so
 * the editor reads as part of the workspace instead of a window into another
 * product. Syntax colours are content, like diagram tones: they live inside
 * the editor and inside code blocks in a brief, and nowhere else. Both come
 * from lib/ui/syntax.ts, so Python reads the same in each.
 */
import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { SYNTAX } from "@/lib/ui/syntax";

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

const highlight = HighlightStyle.define(SYNTAX.map(({ tag, name, italic }) => ({
  tag, color: `var(--syntax-${name})`, ...(italic ? { fontStyle: "italic" } : {}),
})));

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
