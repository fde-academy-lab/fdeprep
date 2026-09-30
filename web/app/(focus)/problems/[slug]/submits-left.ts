import type { Decision } from "@/lib/policy";

/**
 * The submit allowance, said only when it can run out in a sitting. Easy's
 * cap of a thousand a day is a ceiling for runaway scripts, and printing
 * "1000 of 1000 left" tells a learner nothing.
 */
export function submitsLeft(policy: Decision): string | null {
  const { max, remaining } = policy.submit;
  if (max === null || max > 50) return null;
  return remaining === 1 ? "1 submit left today" : `${remaining} of ${max} submits left today`;
}
