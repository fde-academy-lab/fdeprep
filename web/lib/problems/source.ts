/**
 * Which YAML files under problems/ an import may publish.
 *
 * problems/_fixtures/ holds the problems the test suite runs against. They are
 * deliberately small and deliberately strange: one exists to prove a budget
 * binds, another to prove an adversarial tool is handled. Published into the
 * catalogue they sit beside the real twenty-five under titles like "Echo the
 * question", and a learner cannot tell which is which.
 *
 * They are still validated in CI, because a broken fixture breaks the suite,
 * and tests/helpers.ts still imports them directly on purpose. This is only
 * about what reaches the catalogue.
 */
import { readdir } from "node:fs/promises";
import path from "node:path";

/** Directory names an import walks past. */
export const NOT_PUBLISHABLE = new Set(["_fixtures"]);

export async function publishableYamlFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (NOT_PUBLISHABLE.has(entry.name)) continue;
      found.push(...(await publishableYamlFiles(full)));
    } else if (entry.name.endsWith(".yaml")) {
      found.push(full);
    }
  }
  return found.sort();
}
