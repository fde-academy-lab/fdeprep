/**
 * CLAUDE.md: no component reads `difficulty` directly, everything asks the
 * policy module. Difficulty behaviour changes often and scattered checks drift
 * out of step, which is the whole reason the rule exists.
 *
 * What counts as a violation is a *decision* taken on the field: comparing it
 * to a tier name, switching on it, or indexing a lookup with it. Passing it to
 * the policy engine, rendering it as a label, or naming a SQL column is not.
 */

const TIERS = new Set(["easy", "medium", "hard", "extreme"]);

/**
 * Files allowed to decide on difficulty.
 *
 * tests/fixtures is here because a hand-computed fixture names tiers as data: a
 * heatmap expectation written out cell by cell is the thing a person checks by
 * hand, and it cannot ask the policy module what it expects without asking the
 * code under test. Test bodies stay covered by the rule, which is how the
 * learner-test gate and the builder ladder ended up being read from policy
 * rather than hard-coded.
 */
const ALLOWED = [
  /\/lib\/policy\//, /\/eslint-rules\//, /\/migrations\//, /\/tests\/fixtures\//,
];

function isDifficultyExpression(node) {
  if (!node) return false;
  if (node.type === "Identifier") return node.name === "difficulty";
  if (node.type === "MemberExpression" && !node.computed) {
    return node.property.type === "Identifier" && node.property.name === "difficulty";
  }
  if (node.type === "MemberExpression" && node.computed) {
    return node.property.type === "Literal" && node.property.value === "difficulty";
  }
  if (node.type === "TSNonNullExpression" || node.type === "TSAsExpression") {
    return isDifficultyExpression(node.expression);
  }
  return false;
}

function isTierLiteral(node) {
  return node && node.type === "Literal" && typeof node.value === "string" &&
    TIERS.has(node.value);
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid deciding behaviour from `difficulty` outside lib/policy. Ask the policy module.",
    },
    schema: [],
    messages: {
      comparison:
        "This compares difficulty to {{tier}}. Ask the policy module instead: it owns what each " +
        "tier does, and a check here drifts the first time a tier changes.",
      switched:
        "This switches on difficulty. Ask the policy module for the decision you actually need.",
      indexed:
        "This indexes a lookup with difficulty, which is a tier table in disguise. Move it into " +
        "lib/policy.",
    },
  },

  create(context) {
    const filename = context.filename ?? context.getFilename();
    if (ALLOWED.some((pattern) => pattern.test(filename.replaceAll("\\", "/")))) {
      return {};
    }

    return {
      BinaryExpression(node) {
        if (!["===", "!==", "==", "!="].includes(node.operator)) return;
        const left = isDifficultyExpression(node.left) && isTierLiteral(node.right);
        const right = isDifficultyExpression(node.right) && isTierLiteral(node.left);
        if (left || right) {
          const tier = isTierLiteral(node.right) ? node.right.value : node.left.value;
          context.report({ node, messageId: "comparison", data: { tier } });
        }
      },

      SwitchStatement(node) {
        if (isDifficultyExpression(node.discriminant)) {
          context.report({ node, messageId: "switched" });
        }
      },

      MemberExpression(node) {
        if (node.computed && isDifficultyExpression(node.property)) {
          context.report({ node, messageId: "indexed" });
        }
      },
    };
  },
};
