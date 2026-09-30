/**
 * Whether the page names a problem's traps, the mistakes its hidden cases
 * catch. The tier decides whether they show before an attempt; every tier
 * shows them once the attempt is solved or given up, as part of the review.
 */
import type { Tier } from "./tiers.ts";

export function trapsVisible(tier: Pick<Tier, "trapsBeforeAttempt">,
                             state: { solved: boolean; gaveUp: boolean }): boolean {
  return tier.trapsBeforeAttempt || state.solved || state.gaveUp;
}
