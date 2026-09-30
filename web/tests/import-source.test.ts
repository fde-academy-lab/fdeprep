/**
 * What the admin import screen is allowed to publish.
 *
 * Run against the real problems/ tree rather than a temporary directory,
 * because the thing worth asserting is a fact about this repository: there are
 * twenty-five problems for learners and eleven fixtures for the test suite, and
 * only the first set belongs in a catalogue.
 */
import { readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NOT_PUBLISHABLE, publishableYamlFiles } from "../lib/problems/source.ts";

const PROBLEMS = path.join(import.meta.dirname, "..", "..", "problems");

async function everyYamlFile(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await everyYamlFile(full)));
    else if (entry.name.endsWith(".yaml")) found.push(full);
  }
  return found;
}

describe("the publishable set", () => {
  it("leaves every fixture out", async () => {
    const publishable = await publishableYamlFiles(PROBLEMS);
    expect(publishable).not.toEqual([]);
    for (const file of publishable) {
      expect(file, file).not.toContain(`${path.sep}_fixtures${path.sep}`);
    }
  });

  it("is every catalogue problem, and never fewer than the launch set", async () => {
    // docs/00 section 9 as amended on 29 September 2026: the twenty-five are a
    // floor and the catalogue grows past them. So the check is that every
    // non-fixture file is publishable, counted independently, and that the
    // floor still holds.
    const publishable = await publishableYamlFiles(PROBLEMS);
    const all = await everyYamlFile(PROBLEMS);
    const catalogue = all.filter((f) => !f.includes(`${path.sep}_fixtures${path.sep}`));
    expect(publishable.sort()).toEqual(catalogue.sort());
    expect(publishable.length).toBeGreaterThanOrEqual(25);
  });

  it("accounts for every file on disk, so nothing is dropped by accident", async () => {
    const all = await everyYamlFile(PROBLEMS);
    const publishable = await publishableYamlFiles(PROBLEMS);
    const excluded = all.filter((f) => !publishable.includes(f));

    expect(all).toHaveLength(publishable.length + excluded.length);
    expect(excluded).toHaveLength(12);
    for (const file of excluded) {
      expect(file, file).toContain(`${path.sep}_fixtures${path.sep}`);
    }
  });

  it("names what it skips, rather than pattern-matching a leading underscore", async () => {
    // A rule that skipped anything starting with an underscore would silently
    // swallow a future problems/_drafts, and an author would spend an
    // afternoon wondering why their file will not import.
    expect([...NOT_PUBLISHABLE]).toEqual(["_fixtures"]);
  });
});
