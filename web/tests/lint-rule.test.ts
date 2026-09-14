/**
 * The guard needs its own guard. A lint rule that never fires enforces
 * nothing, and one that fires on legitimate code gets disabled within a week.
 */
import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";

const eslint = new ESLint({ cwd: new URL("..", import.meta.url).pathname });

async function lint(source: string) {
  const [result] = await eslint.lintText(source, { filePath: "lib/components/probe.ts" });
  return (result?.messages ?? []).filter((m) => m.ruleId === "fdeprep/no-direct-difficulty");
}

describe("no-direct-difficulty catches a decision taken on the field", () => {
  it("flags a comparison to a tier name", async () => {
    const messages = await lint(
      `declare const p: { difficulty: string };\nexport const x = p.difficulty === "extreme";`);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.message).toContain("Ask the policy module");
  });

  it("flags an inequality against a tier name", async () => {
    const messages = await lint(
      `declare const p: { difficulty: string };\nexport const x = p.difficulty !== "easy";`);
    expect(messages).toHaveLength(1);
  });

  it("flags a switch on difficulty", async () => {
    const messages = await lint(
      `declare const p: { difficulty: string };\n` +
      `export function f() { switch (p.difficulty) { case "hard": return 1; } return 0; }`);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.message).toContain("switches on difficulty");
  });

  it("flags a lookup indexed by difficulty, which is a tier table in disguise", async () => {
    const messages = await lint(
      `declare const p: { difficulty: string };\ndeclare const L: Record<string, number>;\n` +
      `export const x = L[p.difficulty];`);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.message).toContain("tier table in disguise");
  });

  it("flags a bare difficulty identifier compared to a tier", async () => {
    const messages = await lint(
      `export function f(difficulty: string) { return difficulty === "medium"; }`);
    expect(messages).toHaveLength(1);
  });
});

describe("no-direct-difficulty leaves legitimate uses alone", () => {
  it("allows passing it to the policy module", async () => {
    expect(await lint(
      `declare const p: { difficulty: string };\ndeclare function tierFor(d: string): number;\n` +
      `export const x = tierFor(p.difficulty);`)).toHaveLength(0);
  });

  it("allows rendering it as a label", async () => {
    expect(await lint(
      "declare const p: { difficulty: string };\nexport const x = `Tier: ${p.difficulty}`;"))
      .toHaveLength(0);
  });

  it("allows naming it as a SQL column", async () => {
    expect(await lint(
      `export const q = "select p.difficulty::text from problem p where p.difficulty = $1";`))
      .toHaveLength(0);
  });

  it("allows a presence check, which is not a tier decision", async () => {
    expect(await lint(
      `declare const p: { difficulty?: string };\nexport const x = p.difficulty === undefined;`))
      .toHaveLength(0);
  });
});

describe("the rule exempts the policy module itself", () => {
  it("allows a tier comparison inside lib/policy", async () => {
    const [result] = await eslint.lintText(
      `declare const p: { difficulty: string };\nexport const x = p.difficulty === "extreme";`,
      { filePath: "lib/policy/probe.ts" });
    expect((result?.messages ?? []).filter((m) => m.ruleId === "fdeprep/no-direct-difficulty"))
      .toHaveLength(0);
  });
});
