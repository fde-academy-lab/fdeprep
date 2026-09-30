/** A backticked span, as the problem files write names in code. */
export const CODE_SPAN = /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g;

/** A field's text with the backticks taken out, for a place that cannot render code. */
export function withoutCodeMarks(text: string): string {
  return text.replace(CODE_SPAN, (_match, _ticks, body: string) => body);
}
