/**
 * The seed writes no grade. Bolt 7 of the seed brief.
 *
 * CLAUDE.md: eval/ is the only writer of a grade, a band or a competency
 * state. The seed reaches those through writeResult, saveEvaluation,
 * scoreVoiceOnce, recordReview and the override, which it imports, and never
 * with SQL of its own. This reads every file the seed runs and fails on a
 * statement that would break that, in the style of tests/fairness.test.ts.
 *
 * What the seed may write itself, and where:
 *   inserts  app_user, cohort and enrolment, the roster, in lib/seed/run.ts
 *   updates  timestamps only, through the allowlist in lib/seed/rewind.ts
 *   deletes  lib/seed/replace.ts, which follows foreign keys from the seeded
 *            cohorts, and the audit rows the seeded people wrote
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REWIND } from "../lib/seed/rewind.ts";

const ROOT = path.join(import.meta.dirname, "..");
const SEED = path.join(ROOT, "lib", "seed");

async function sources(): Promise<Array<{ file: string; text: string }>> {
  const files = (await readdir(SEED)).filter((f) => f.endsWith(".ts"))
    .map((f) => path.join("lib", "seed", f));
  files.push(path.join("scripts", "seed.ts"));
  return Promise.all(files.map(async (file) => ({
    file, text: await readFile(path.join(ROOT, file), "utf8"),
  })));
}

/** The code without its comments, which may mention a table in prose. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const GRADE_TABLES = ["evaluation", "competency_score", "evaluation_review"];
const GRADE_COLUMN = /^(verdict|score|band|state)$|_score$/;

interface Write { file: string; verb: string; table: string; columns: string[] }

function writes(file: string, text: string): Write[] {
  const out: Write[] = [];
  // "do update set" belongs to an insert's on conflict clause, not a statement of its own.
  const statement = /\b(insert\s+into|(?<!do\s)update|delete\s+from)\s+(\$\{[^}]+\}|[a-z_]+)(\s*\(([^)]*)\))?/gi;
  for (const match of code(text).matchAll(statement)) {
    const verb = match[1]!.toLowerCase().replace(/\s+/g, " ");
    out.push({
      file, verb, table: match[2]!,
      columns: verb === "insert into" && match[4]
        ? match[4].split(",").map((c) => c.trim()).filter(Boolean) : [],
    });
  }
  return out;
}

describe("the seed writes no grade", () => {
  it("never names competency_score or inserts into evaluation, as acceptance 3 greps", async () => {
    for (const { file, text } of await sources()) {
      expect(text, file).not.toMatch(/competency_score/);
      expect(text, file).not.toMatch(/insert\s+into\s+evaluation/i);
    }
  });

  it("writes no grade table and no grade column", async () => {
    const all = (await sources()).flatMap(({ file, text }) => writes(file, text));
    expect(all.length).toBeGreaterThan(0);
    for (const write of all) {
      const where = `${write.file}: ${write.verb} ${write.table}`;
      expect(GRADE_TABLES, where).not.toContain(write.table);
      for (const column of write.columns) {
        // The enrolment's state is the roster (active, paused, ended), not a grade.
        if (write.table === "enrolment" && column === "state") continue;
        expect(column, where).not.toMatch(GRADE_COLUMN);
      }
    }
  });

  it("inserts only the roster, updates only through the rewind, deletes only in replace", async () => {
    for (const write of (await sources()).flatMap(({ file, text }) => writes(file, text))) {
      const where = `${write.file}: ${write.verb} ${write.table}`;
      if (write.verb === "insert into") {
        expect(["app_user", "cohort", "enrolment"], where).toContain(write.table);
      } else if (write.verb === "update") {
        expect(write.file, where).toBe(path.join("lib", "seed", "rewind.ts"));
        expect(write.table, where).toMatch(/^\$\{/);
      } else {
        expect(write.file, where).toBe(path.join("lib", "seed", "replace.ts"));
        expect(write.table === "audit_log" || write.table.startsWith("${"), where).toBe(true);
      }
    }
  });

  it("rewinds moments and nothing else", () => {
    for (const [table, columns] of Object.entries(REWIND)) {
      for (const column of columns) {
        expect(column, `${table}.${column}`).toMatch(/_at$|^window_start$/);
        expect(column, `${table}.${column}`).not.toMatch(GRADE_COLUMN);
      }
    }
  });
});
