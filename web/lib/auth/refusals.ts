/**
 * Every way sign-in can refuse someone, and the sentence each one gets.
 *
 * The first three are docs/01 section S1's, word for word, because each has a
 * different owner and a learner needs to know which door is shut. The three
 * invite refusals were added for the beta on 30 September 2026, and each names
 * the next action, which is always the same: ask whoever sent the link.
 *
 * One table, read by the access check that decides and by the sign-in screen
 * that explains, so the two cannot drift.
 */
export type AccessRefusal =
  | "not_a_member"
  | "not_enrolled"
  | "enrolment_ended"
  | "invite_used"
  | "invite_invalid"
  | "invite_other_account";

export const REFUSALS: Record<AccessRefusal, string> = {
  not_a_member: "Your GitHub account is not in the FDE Academy organisation yet.",
  not_enrolled: "Your account is not enrolled in an active cohort.",
  enrolment_ended: "Your enrolment has ended. Past submissions stay readable for thirty days.",
  invite_used: "That invite link has already been used. Ask whoever sent it for a new one.",
  invite_invalid: "That invite link is no longer valid. Ask whoever sent it for a new one.",
  invite_other_account:
    "That invite is for a different GitHub account. Sign in with the account it was sent to, " +
    "or ask for a new invite.",
};
