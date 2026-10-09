/**
 * Only eval/ writes a grade, a band or a competency state. Story S15.7.
 *
 * CLAUDE.md's standing rule, and docs/10 section 13 as amended 8 October 2026.
 * This reads every file under web/lib, web/app and web/scripts and fails on a
 * SQL statement that writes a grade from anywhere it should not. It reads
 * statements the way tests/seed-writer.test.ts does, which polices the seed
 * alone, and adds the columns an update sets.
 *
 * A grade lives in two kinds of place:
 *   tables that hold nothing else   evaluation, evaluation_review, competency_score
 *   columns of tables that do       a submission's verdict and score, an
 *                                   attempt's defence score, a voice
 *                                   session's scores
 *
 * lib/eval/ may write all of them. Two writers outside it keep a grade column,
 * named in WRITERS with the reason each stays where it is. Nothing else may.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.join(import.meta.dirname, "..");
const SCANNED = ["lib", "app", "scripts"];
const EVAL = "lib/eval/";

/** Tables whose every row is a grade, a band, a review of one or a competency state. */
const GRADE_TABLES = ["evaluation", "evaluation_review", "competency_score"];

/** Grade columns on tables that also hold things nobody grades. */
const GRADE_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  submission: ["verdict", "score"],
  attempt: ["defence_score"],
  voice_session: ["score", "content_score", "structure_score", "pace_score"],
};

/**
 * The two writers outside lib/eval/, and what each may write.
 *
 * Both write a grade column and neither writes a grade table: the competency
 * write they set off is lib/eval/competency.ts, and the evaluation row is
 * saveEvaluation in lib/eval/record.ts.
 */
const WRITERS: ReadonlyArray<{
  file: string; writes: Readonly<Record<string, readonly string[]>>; why: string;
}> = [
  {
    file: "lib/queue/result-writer.ts",
    writes: { submission: ["verdict", "score"], attempt: ["defence_score"] },
    why: "writeResult commits a submission's terminal verdict and score with the " +
         "compare-and-set on the runner's lease that docs/03 section 9.3 requires, and the " +
         "defence score in the same transaction. Moving the write into lib/eval/ would " +
         "split the lease logic across two modules.",
  },
  {
    file: "lib/voice/judge.ts",
    writes: { voice_session: ["score", "content_score", "structure_score", "pace_score"] },
    why: "scoreVoiceOnce writes a voice session's score. A voice session is not a " +
         "submission and has no evaluation row, so its score has no other place to live.",
  },
];

/**
 * Statements whose table is computed, which a scan of the source cannot read.
 * Each is named with what it writes and what holds it to that, so a new
 * computed table fails here until somebody says why it is safe.
 */
const COMPUTED: Readonly<Record<string, string>> = {
  "lib/seed/rewind.ts": "moves timestamps back and nothing else; tests/seed-writer.test.ts " +
                        "holds the REWIND allowlist to moments",
  "lib/seed/replace.ts": "deletes the seeded cohorts and the rows below them, which removes " +
                         "a development seed and grades nobody; tests/seed-writer.test.ts",
  "lib/voice/import.ts": "replaces a voice question's authored beats, criteria and " +
                         "exemplars when the question is imported again",
};

/**
 * An error verdict is the platform's failure and says nothing about the
 * learner (docs/12 section 1): it moves no cell and consumes no allowance. The
 * lease reaper in lib/queue/dispatcher.ts writes one when a runner stops
 * answering, and that is not a grade.
 */
function isGrade(table: string, column: string, value: string | null): boolean {
  if (!GRADE_COLUMNS[table]?.includes(column)) return false;
  return !(column === "verdict" && value !== null && /^'error'(::verdict)?$/.test(value.trim()));
}

async function files(dir: string): Promise<string[]> {
  const entries = await readdir(path.join(ROOT, dir), { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const relative = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) return files(relative);
    return Promise.resolve(/\.tsx?$/.test(entry.name) ? [relative] : []);
  }));
  return nested.flat();
}

async function sources(): Promise<Array<{ file: string; text: string }>> {
  const all = (await Promise.all(SCANNED.map(files))).flat();
  return Promise.all(all.map(async (file) => ({
    file, text: code(await readFile(path.join(ROOT, file), "utf8")),
  })));
}

/** The code without its comments, which may mention a table in prose. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

interface Write {
  file: string;
  verb: "insert into" | "update" | "delete from";
  table: string;
  /** Columns an insert names or an update sets, with the value set where there is one. */
  columns: Array<{ name: string; value: string | null }>;
}

/**
 * Where a clause ends. With `keywords`, at a top-level where, from or
 * returning, which is how a SET clause ends; always at the end of the string
 * literal the statement sits in. Parentheses and SQL string literals are
 * stepped over, so `extract(epoch from now())` or a message containing
 * "where" does not end it early.
 */
function clauseEnd(text: string, start: number, keywords = true): number {
  let depth = 0;
  let quoted = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === "'") quoted = false;
      continue;
    }
    if (ch === "'") quoted = true;
    else if (ch === "`" || ch === "\"") return i;
    else if (ch === "(") depth += 1;
    else if (ch === ")") {
      if (depth === 0 && keywords) return i;
      depth = Math.max(0, depth - 1);
    } else if (keywords && depth === 0 && /\W/.test(text[i - 1] ?? " ") &&
               /^(where|from|returning)\b/i.test(text.slice(i, i + 10))) {
      return i;
    }
  }
  return text.length;
}

/** `a = 1, b = coalesce(b, 2)` as [{a, 1}, {b, coalesce(b, 2)}]. */
function assignments(clause: string): Array<{ name: string; value: string | null }> {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let current = "";
  for (const ch of clause) {
    if (quoted) {
      if (ch === "'") quoted = false;
    } else if (ch === "'") quoted = true;
    else if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    else if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts.flatMap((part) => {
    const match = /^\s*(?:[a-z_]+\.)?([a-z_]+|\$\{[^}]+\})\s*=\s*([\s\S]*)$/i.exec(part);
    return match ? [{ name: match[1]!, value: match[2]!.trim() }] : [];
  });
}

function writes(file: string, text: string): Write[] {
  const out: Write[] = [];
  // "do update set" belongs to an insert's on conflict clause, read below with the insert.
  const statement = /\b(insert\s+into|(?<!do\s)update|delete\s+from)\s+(\$\{[^}]+\}|[a-z_]+)(\s*\(([^)]*)\))?/gi;
  for (const match of text.matchAll(statement)) {
    const verb = match[1]!.toLowerCase().replace(/\s+/g, " ") as Write["verb"];
    const table = match[2]!;
    const after = match.index! + match[0].length;
    let columns: Write["columns"] = [];

    if (verb === "insert into") {
      columns = (match[4] ?? "").split(",").map((c) => c.trim()).filter(Boolean)
        .map((name) => ({ name, value: null }));
      // An upsert's on conflict clause sets columns of the same table.
      const upsert = /\bdo\s+update\s+set\b/i.exec(text.slice(after, clauseEnd(text, after, false)));
      if (upsert) {
        const start = after + upsert.index + upsert[0].length;
        columns.push(...assignments(text.slice(start, clauseEnd(text, start))));
      }
    } else if (verb === "update") {
      const set = /^\s+(?:[a-z_]+\s+)?set\b/i.exec(text.slice(after));
      // "update" in a sentence, such as "update one." in prose that survived as a string.
      if (!set) continue;
      const start = after + set[0].length;
      columns = assignments(text.slice(start, clauseEnd(text, start)));
    }
    out.push({ file, verb, table, columns });
  }
  return out;
}

const computed = (table: string) => table.startsWith("${");

describe("the statement reader", () => {
  it("reads an update's columns past a function call and an upsert's do update set", () => {
    const source = "await q(`update submission s set verdict = $2::verdict, score = coalesce($3, " +
      "s.score), finished_at = extract(epoch from now()) where id = $1`);\n" +
      "await q(`insert into competency_score (enrolment_id, state) values ($1, $2)\n" +
      "  on conflict (enrolment_id) do update set state = excluded.state, updated_at = now()`);";
    expect(writes("x.ts", source)).toEqual([
      { file: "x.ts", verb: "update", table: "submission", columns: [
        { name: "verdict", value: "$2::verdict" }, { name: "score", value: "coalesce($3, s.score)" },
        { name: "finished_at", value: "extract(epoch from now())" }] },
      { file: "x.ts", verb: "insert into", table: "competency_score", columns: [
        { name: "enrolment_id", value: null }, { name: "state", value: null },
        { name: "state", value: "excluded.state" }, { name: "updated_at", value: "now()" }] },
    ]);
  });

  it("treats an error verdict as the platform's failure and any other verdict as a grade", () => {
    expect(isGrade("submission", "verdict", "'error'")).toBe(false);
    expect(isGrade("submission", "verdict", "$2::verdict")).toBe(true);
    expect(isGrade("submission", "verdict", "'pass'")).toBe(true);
    expect(isGrade("submission", "status", "'terminal'")).toBe(false);
  });
});

describe("only eval/ writes a grade, a band or a competency state", () => {
  it("finds statements to check in every scanned directory", async () => {
    const all = (await sources()).flatMap(({ file, text }) => writes(file, text));
    for (const dir of ["lib/", "scripts/"]) {
      expect(all.some((write) => write.file.startsWith(dir)), dir).toBe(true);
    }
    expect(all.some((write) => write.file.startsWith(EVAL) &&
      write.table === "competency_score")).toBe(true);
  });

  it("writes evaluation, evaluation_review and competency_score from lib/eval/ alone", async () => {
    for (const write of (await sources()).flatMap(({ file, text }) => writes(file, text))) {
      if (!GRADE_TABLES.includes(write.table)) continue;
      expect(write.file, `${write.file}: ${write.verb} ${write.table}`).toMatch(/^lib\/eval\//);
    }
  });

  it("writes a grade column from lib/eval/ or from one of the two named writers", async () => {
    for (const write of (await sources()).flatMap(({ file, text }) => writes(file, text))) {
      if (write.file.startsWith(EVAL)) continue;
      const writer = WRITERS.find((w) => w.file === write.file);
      for (const column of write.columns) {
        if (!isGrade(write.table, column.name, column.value)) continue;
        const where = `${write.file}: ${write.verb} ${write.table} sets ${column.name}`;
        expect(writer?.writes[write.table] ?? [], where).toContain(column.name);
      }
    }
  });

  it("still finds each named writer writing what it is named for", async () => {
    const all = (await sources()).flatMap(({ file, text }) => writes(file, text));
    for (const writer of WRITERS) {
      expect(writer.why.length, writer.file).toBeGreaterThan(40);
      for (const [table, columns] of Object.entries(writer.writes)) {
        for (const column of columns) {
          const found = all.some((w) => w.file === writer.file && w.table === table &&
            w.columns.some((c) => c.name === column));
          expect(found, `${writer.file} no longer writes ${table}.${column}; drop it from WRITERS`)
            .toBe(true);
        }
      }
    }
  });

  it("names every statement whose table it cannot read, and says why it is safe", async () => {
    const all = (await sources()).flatMap(({ file, text }) => writes(file, text));
    const found = new Set(all.filter((w) => computed(w.table)).map((w) => w.file));
    expect([...found].sort()).toEqual(Object.keys(COMPUTED).sort());
  });

  it("finds no write under lib/progress/, and under lib/analytics/ only a report card appended", async () => {
    const all = (await sources()).flatMap(({ file, text }) => writes(file, text));
    for (const write of all) {
      const where = `${write.file}: ${write.verb} ${write.table}`;
      expect(write.file, where).not.toMatch(/^lib\/progress\//);
      if (!write.file.startsWith("lib/analytics/")) continue;
      expect({ file: write.file, verb: write.verb, table: write.table }, where)
        .toEqual({ file: "lib/analytics/report-card.ts", verb: "insert into", table: "report_card" });
    }
  });

  it("never updates or deletes a report card once it is issued", async () => {
    const all = (await sources()).flatMap(({ file, text }) => writes(file, text));
    const cards = all.filter((write) => write.table === "report_card");
    expect(cards.length).toBeGreaterThan(0);
    for (const write of cards) {
      expect(write.verb, `${write.file}: ${write.verb} report_card`).toBe("insert into");
    }
  });

  it("keeps the competency write in lib/eval/competency.ts and imports it from nowhere else's copy", async () => {
    const all = await sources();
    expect(all.some(({ file }) => file === "lib/eval/competency.ts")).toBe(true);
    for (const { file, text } of all) {
      expect(text, file).not.toMatch(/from\s+["'][^"']*competency\/score(\.ts)?["']/);
    }
  });

  it("gives progress/ and analytics/ no scoring import: types from lib/eval/ and nothing that runs", async () => {
    for (const { file, text } of await sources()) {
      if (!/^lib\/(progress|analytics)\//.test(file)) continue;
      for (const match of text.matchAll(/^import\s+(type\s+)?[^;]*?from\s+["']([^"']+)["']/gm)) {
        if (!/(^|\/)eval\//.test(match[2]!)) continue;
        expect(match[1], `${file} imports a value from ${match[2]}`).toBe("type ");
      }
    }
  });
});
