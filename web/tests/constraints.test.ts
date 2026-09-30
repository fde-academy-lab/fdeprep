/**
 * The Constraints table states what the runner enforces, so it has to agree
 * with the runner. A list on the page that disagrees with the gate is worse
 * than no list: a learner trusts it and loses a run to it.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ALWAYS_ALLOWED_IMPORTS, PYTHON_VERSION } from "../lib/problems/constraints.ts";

const ROOT = path.join(import.meta.dirname, "..", "..");

describe("constraints", () => {
  it("lists the imports the runner always allows, in its order", async () => {
    const source = await readFile(path.join(ROOT, "runner", "problem.py"), "utf8");
    const tuple = /ALWAYS_ALLOWED_IMPORTS = \(([^)]*)\)/.exec(source)?.[1] ?? "";
    const names = [...tuple.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(names).toEqual([...ALWAYS_ALLOWED_IMPORTS]);
  });

  it("names the Python version of the runner image", async () => {
    const dockerfile = await readFile(path.join(ROOT, "Dockerfile"), "utf8");
    expect(dockerfile).toContain(`FROM public.ecr.aws/lambda/python:${PYTHON_VERSION}`);
  });
});
