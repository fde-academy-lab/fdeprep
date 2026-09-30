/**
 * The first line of a failed code run: which gate it failed at, counted the
 * way the tier lets the learner see it. A tier that hides the hidden count
 * (docs/00 section 3.2) hears only that a test it cannot see failed.
 */
import type { GateView } from "./view.ts";

type Gates = { public: GateView; hidden: GateView; adversarial: GateView };

export function failHeadline(gates: Gates, visibility: { hiddenCount: boolean }): string {
  const { public: pub, hidden, adversarial } = gates;
  if (pub.status !== "pass") return `${pub.passed} of ${pub.total} public tests passed.`;
  if (hidden.status !== "fail" && adversarial.status !== "fail") {
    return `${pub.passed} of ${pub.total} public tests passed.`;
  }
  if (!visibility.hiddenCount) return "Every public test passed, and a test you cannot see failed.";
  if (hidden.status === "fail") {
    return `Every public test passed, and ${hidden.total - hidden.passed} of ${hidden.total} hidden tests failed.`;
  }
  return `Every public and hidden test passed, and ${adversarial.total - adversarial.passed} of ` +
    `${adversarial.total} adversarial tests failed.`;
}
