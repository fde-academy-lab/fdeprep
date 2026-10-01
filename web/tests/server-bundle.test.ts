/**
 * Every page, route and the proxy can load inside Next's server bundle.
 *
 * Found by running the Voice Screen locally on 1 October 2026: after Stop and
 * debrief, the debrief and the Past answers list answered 500 for every
 * session, and `next build` stopped at /voice/sessions/[id]. PR #44 made both
 * pages import MAX_JUDGE_ATTEMPTS from lib/voice/judge.ts, which loads
 * lib/queue/judge-worker.ts, which reads import.meta.dirname as it loads.
 * Next's server bundle leaves that undefined, so path.join threw before either
 * page rendered. Vitest and tsx define it, which is why no test saw it, and
 * why this one reads the imports rather than running them.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const WEB = path.join(import.meta.dirname, "..");

describe("what the server bundles", () => {
  /**
   * Every module a page, a route or the proxy can reach, found by following
   * imports the way the bundler does. Type-only imports are skipped, because
   * they are erased before anything runs.
   */
  function reachable(): Map<string, string | null> {
    const seen = new Map<string, string | null>();
    const queue: string[] = [];
    const visit = (file: string, from: string | null) => {
      if (seen.has(file)) return;
      seen.set(file, from);
      queue.push(file);
    };
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      return statSync(full).isDirectory() ? walk(full) : /\.tsx?$/.test(name) ? [full] : [];
    });
    for (const entry of [...walk(path.join(WEB, "app")), path.join(WEB, "proxy.ts")]) {
      visit(entry, null);
    }
    while (queue.length > 0) {
      const file = queue.shift()!;
      const source = readFileSync(file, "utf8");
      const specifiers = [
        ...[...source.matchAll(/(?:import|export)\s+(type\s+)?[^'";]*?\bfrom\s+["']([^"']+)["']/g)]
          .filter((match) => !match[1]).map((match) => match[2]!),
        ...[...source.matchAll(/import\s*\(\s*["']([^"']+)["']\s*\)/g)].map((match) => match[1]!),
        ...[...source.matchAll(/^import\s+["']([^"']+)["']/gm)].map((match) => match[1]!),
      ];
      for (const specifier of specifiers) {
        const base = specifier.startsWith("@/") ? path.join(WEB, specifier.slice(2))
          : specifier.startsWith(".") ? path.resolve(path.dirname(file), specifier) : null;
        if (!base) continue;
        const found = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]
          .map((suffix) => base + suffix)
          .find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
        if (found) visit(found, file);
      }
    }
    return seen;
  }

  test("no page, route or the proxy reaches a module that reads its own path as it loads", () => {
    const seen = reachable();
    const offenders: string[] = [];
    for (const file of seen.keys()) {
      const code = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
      if (!/import\.meta\.(dirname|filename)/.test(code)) continue;
      const chain: string[] = [];
      for (let at: string | null = file; at; at = seen.get(at) ?? null) {
        chain.unshift(path.relative(WEB, at));
      }
      offenders.push(chain.join(" -> "));
    }
    expect(
      offenders,
      "Next's server bundle leaves import.meta.dirname and import.meta.filename undefined, " +
        `so these pages fail before they render:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  test("the walk reaches the pages that broke, so the check above is looking at them", () => {
    const seen = reachable();
    for (const page of ["app/(shell)/voice/sessions/[id]/page.tsx", "app/(shell)/voice/sessions/page.tsx"]) {
      expect(seen.has(path.join(WEB, page)), page).toBe(true);
    }
    expect(seen.has(path.join(WEB, "lib", "voice", "debrief.ts"))).toBe(true);
    expect(seen.has(path.join(WEB, "lib", "voice", "score.ts"))).toBe(true);
  });
});
