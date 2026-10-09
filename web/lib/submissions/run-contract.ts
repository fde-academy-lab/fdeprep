/**
 * What a Run's result may carry, in one place for the writer, the view and the
 * coach.
 *
 * docs/00 section 4 and docs/01 S4: a Run executes the public tests only. It
 * reports nothing about the hidden or adversarial cases, not a count, a name,
 * a message or a trace, and it carries no score, because the score needs the
 * hidden ratio (docs/03 section 5).
 *
 * The runner keeps to that since 8 October 2026. Before then the worker never
 * told it the kind, so every Run ran the whole battery, and a runner image
 * older than that fix still does. The readers check as well as the runner,
 * because a Run row written before the fix is still in the database and a
 * rolled-back runner image is one command away (docs/05).
 */

/** The batteries a Run never runs. */
export const NOT_ON_A_RUN = ["hidden", "adversarial"] as const;

/** The gate a Run reports for a battery it never ran: skipped, with no count. */
export function withheldGate(): { status: "skipped"; passed: 0; total: 0; cases: never[] } {
  return { status: "skipped", passed: 0, total: 0, cases: [] };
}

/** True when a hidden or adversarial case ran, which a Run never does. */
export function ranUnpublishedCases(result: Record<string, unknown>): boolean {
  const gates = (result["gates"] ?? {}) as Record<string, { status?: unknown } | undefined>;
  return NOT_ON_A_RUN.some((name) => {
    const status = gates[name]?.status;
    return status === "pass" || status === "fail";
  });
}

/** The result with nothing a Run may not carry: no hidden or adversarial count, and no score. */
export function keptToRun(result: Record<string, unknown>): Record<string, unknown> {
  const kept: Record<string, unknown> = { ...result, score: null };
  if (result["gates"] && typeof result["gates"] === "object") {
    const gates = { ...(result["gates"] as Record<string, unknown>) };
    for (const name of NOT_ON_A_RUN) gates[name] = withheldGate();
    kept["gates"] = gates;
  }
  return kept;
}
