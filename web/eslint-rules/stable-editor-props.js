/**
 * The CodeMirror wrapper (@uiw/react-codemirror 4.25) reconfigures the whole
 * editor whenever its basicSetup or extensions prop changes identity: every
 * extension is rebuilt, the gutters and the language included. An object or
 * array literal written in the JSX, or a call made there, is a new value on
 * every render. The workspace passed one, and it rendered on every key, so
 * every key rebuilt the editor.
 *
 * Declare the value at module level, or memoise it, and pass the name.
 */

const WATCHED = new Set(["basicSetup", "extensions"]);
const FRESH = new Set([
  "ObjectExpression", "ArrayExpression", "CallExpression", "NewExpression",
  "ArrowFunctionExpression", "FunctionExpression",
]);

export default {
  meta: {
    type: "problem",
    docs: { description: "Keep the editor's basicSetup and extensions stable across renders." },
    schema: [],
  },
  create(context) {
    return {
      JSXAttribute(node) {
        const element = node.parent;
        if (element?.type !== "JSXOpeningElement") return;
        if (element.name.type !== "JSXIdentifier" || element.name.name !== "CodeMirror") return;
        if (node.name.type !== "JSXIdentifier" || !WATCHED.has(node.name.name)) return;
        const value = node.value?.type === "JSXExpressionContainer" ? node.value.expression : null;
        if (!value || !FRESH.has(value.type)) return;
        context.report({
          node,
          message: `CodeMirror's ${node.name.name} is built inline, so it is new on every render ` +
                   "and the editor rebuilds itself each time. Declare it at module level or " +
                   "memoise it.",
        });
      },
    };
  },
};
