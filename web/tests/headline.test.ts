/**
 * The first line of a failed code run. It used to count public tests only,
 * so a run that passed them and failed a hidden test read "2 of 2 public
 * tests pass." in red, beside a red Hidden chip.
 */
import { describe, expect, it } from "vitest";
import { failHeadline } from "../lib/submissions/headline.ts";
import type { GateView } from "../lib/submissions/view.ts";

const gate = (status: GateView["status"], passed: number, total: number): GateView =>
  ({ status, passed, total, cases: [] });
const SHOWN = { hiddenCount: true };
const HIDDEN = { hiddenCount: false };

describe("the headline of a failed run", () => {
  it("counts the public tests while they are what fails", () => {
    const gates = { public: gate("fail", 1, 2), hidden: gate("skipped", 0, 3), adversarial: gate("skipped", 0, 0) };
    expect(failHeadline(gates, SHOWN)).toBe("1 of 2 public tests passed.");
  });

  it("says a hidden test failed when every public test passed", () => {
    const gates = { public: gate("pass", 2, 2), hidden: gate("fail", 1, 3), adversarial: gate("skipped", 0, 1) };
    expect(failHeadline(gates, SHOWN)).toBe("Every public test passed, and 2 of 3 hidden tests failed.");
  });

  it("gives no hidden count on a tier that shows none", () => {
    const gates = { public: gate("pass", 2, 2), hidden: gate("fail", 1, 3), adversarial: gate("skipped", 0, 1) };
    const line = failHeadline(gates, HIDDEN);
    expect(line).toBe("Every public test passed, and a test you cannot see failed.");
    expect(line).not.toMatch(/\d of \d/);
  });

  it("says an adversarial test failed when the rest passed", () => {
    const gates = { public: gate("pass", 2, 2), hidden: gate("pass", 3, 3), adversarial: gate("fail", 1, 2) };
    expect(failHeadline(gates, SHOWN)).toBe(
      "Every public and hidden test passed, and 1 of 2 adversarial tests failed.");
    expect(failHeadline(gates, HIDDEN)).toBe(
      "Every public test passed, and a test you cannot see failed.");
  });
});
