/**
 * Joins class names, dropping the falsy ones.
 *
 * One conflict is resolved: a later display utility replaces an earlier one
 * at the same breakpoint. Components carry their own display (a key cap is
 * inline-flex), and a caller hiding one on small screens passes
 * "hidden lg:inline-flex". Both would otherwise reach the element and CSS
 * order, rather than the caller, would decide which wins. Nothing else is
 * merged, so every other utility behaves exactly as written.
 */
const DISPLAY = /^(hidden|block|inline|inline-block|flex|inline-flex|grid|inline-grid|contents|table)$/;
const VARIANTED = /^((?:[a-z0-9-[\]]+:)*)(.*)$/;

export function cn(...parts: Array<string | false | null | undefined>): string {
  const tokens = parts.filter(Boolean).join(" ").split(/\s+/).filter(Boolean);
  const last = new Map<string, number>();
  tokens.forEach((token, index) => {
    const [, variant = "", utility = ""] = VARIANTED.exec(token) ?? [];
    if (DISPLAY.test(utility)) last.set(variant, index);
  });
  return tokens.filter((token, index) => {
    const [, variant = "", utility = ""] = VARIANTED.exec(token) ?? [];
    return !DISPLAY.test(utility) || last.get(variant) === index;
  }).join(" ");
}
