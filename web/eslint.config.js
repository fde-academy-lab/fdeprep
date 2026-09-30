import tseslint from "typescript-eslint";
import noDirectDifficulty from "./eslint-rules/no-direct-difficulty.js";
import stableEditorProps from "./eslint-rules/stable-editor-props.js";

const local = {
  rules: { "no-direct-difficulty": noDirectDifficulty, "stable-editor-props": stableEditorProps },
};

export default tseslint.config(
  { ignores: [".next/**", "node_modules/**", "eslint-rules/**"] },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { fdeprep: local },
    rules: {
      // CLAUDE.md standing rule, enforced rather than remembered.
      "fdeprep/no-direct-difficulty": "error",
      // A keystroke re-rendered the workspace and rebuilt the editor with it.
      "fdeprep/stable-editor-props": "error",
    },
  },
);
