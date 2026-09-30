/**
 * Names in code inside a plain field: the scenario card, the diagram, the
 * approach map, the coach, the steps and the labels. Only backticked spans are
 * picked out, so an asterisk or an underscore stays what the author typed.
 *
 * Kept apart from the Markdown renderer, which colours Python and so carries
 * the Python grammar, so the home page and the catalogue do not load it.
 */
import type { ReactNode } from "react";
import { CODE_SPAN } from "@/lib/ui/code-marks";

export { withoutCodeMarks } from "@/lib/ui/code-marks";

export const CODE_CLASS = "rounded-key border border-border bg-surface-2 px-1 py-px font-mono " +
  "text-[0.92em] text-text";

export function renderCode(text: string, keyPrefix = "c"): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const match of text.matchAll(CODE_SPAN)) {
    const index = match.index ?? 0;
    if (index > last) out.push(text.slice(last, index));
    out.push(<code key={`${keyPrefix}-${n++}`} className={CODE_CLASS}>
      {match[2]!.trim() === "" ? match[2] : match[2]!.replace(/^ (.*) $/, "$1")}
    </code>);
    last = index + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
