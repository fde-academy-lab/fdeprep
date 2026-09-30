/**
 * CodeMirror needs exactly one copy of @codemirror/state and @codemirror/view.
 *
 * package.json pinned state at 6.5.2 and view at 6.38.6, and later releases of
 * @codemirror/commands and @codemirror/lint asked for newer ones, so npm
 * nested second copies under them. The undo history lives in commands, it
 * was built against the second copy of state, and Ctrl+Z did nothing in any
 * editor on the platform. Nothing failed loudly; this test is the loud part.
 */
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const app = createRequire(import.meta.url);

/** What `specifier` resolves to when `pkg` itself imports it. */
function resolvedFrom(pkg: string, specifier: string): string {
  return createRequire(app.resolve(pkg)).resolve(specifier);
}

const USERS = [
  "@codemirror/commands", "@codemirror/lint", "@codemirror/search", "@codemirror/autocomplete",
  "@codemirror/language", "@codemirror/lang-python", "@uiw/react-codemirror",
  "@uiw/codemirror-extensions-basic-setup",
];

describe("one copy of CodeMirror's core", () => {
  for (const core of ["@codemirror/state", "@codemirror/view"]) {
    it(`every editor package gets the app's ${core}`, () => {
      const expected = app.resolve(core);
      const strays = USERS.filter((pkg) => resolvedFrom(pkg, core) !== expected)
        .map((pkg) => `${pkg} -> ${resolvedFrom(pkg, core)}`);
      expect(strays).toEqual([]);
    });
  }
});
