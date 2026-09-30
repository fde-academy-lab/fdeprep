/**
 * The editor wrapper rebuilds the whole editor whenever its basicSetup or
 * extensions prop changes identity. An object literal written inline in the
 * JSX is a new object on every render, and the workspace used to render on
 * every key, so every key reconfigured the editor. The rule refuses the
 * literal; these tests keep the rule honest in both directions.
 */
import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";

const eslint = new ESLint({ cwd: new URL("..", import.meta.url).pathname });

async function lint(source: string) {
  const [result] = await eslint.lintText(source, { filePath: "components/probe.tsx" });
  return (result?.messages ?? []).filter((m) => m.ruleId === "fdeprep/stable-editor-props");
}

const header = `import CodeMirror from "@uiw/react-codemirror";\n` +
               `declare const EXT: unknown[];\ndeclare const SETUP: object;\n`;

describe("stable-editor-props", () => {
  it("flags a basicSetup object written inline", async () => {
    const messages = await lint(header +
      `export const E = () => <CodeMirror basicSetup={{ tabSize: 4 }} extensions={EXT} />;`);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.message).toContain("basicSetup");
  });

  it("flags an extensions array written inline", async () => {
    const messages = await lint(header +
      `export const E = () => <CodeMirror basicSetup={SETUP} extensions={[]} />;`);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.message).toContain("extensions");
  });

  it("flags a value built inline by a call, which is also new on every render", async () => {
    const messages = await lint(header +
      `declare function make(): unknown[];\n` +
      `export const E = () => <CodeMirror basicSetup={SETUP} extensions={make()} />;`);
    expect(messages).toHaveLength(1);
  });

  it("accepts a module constant or a memoised value", async () => {
    const messages = await lint(header +
      `import { useMemo } from "react";\n` +
      `export const E = () => {\n` +
      `  const ext = useMemo(() => [], []);\n` +
      `  return <CodeMirror basicSetup={SETUP} extensions={ext} />;\n` +
      `};`);
    expect(messages).toEqual([]);
  });

  it("leaves other components' props alone", async () => {
    const messages = await lint(
      `declare const Box: (p: { basicSetup: object }) => null;\n` +
      `export const E = () => <Box basicSetup={{ tabSize: 4 }} />;`);
    expect(messages).toEqual([]);
  });
});
