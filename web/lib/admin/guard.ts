/**
 * Who may run an admin action.
 *
 * docs/01 S10: "Faculty see Roster read-only and Submissions in full.
 * Everything else is admin only." Every mutating route calls this, and it reads
 * the role from the session rather than from anything the request carries.
 */
import { currentLearner, type Learner } from "../session/current.ts";

export class Forbidden extends Error {
  readonly status = 403;
  constructor() {
    super("This action is admin only.");
    this.name = "Forbidden";
  }
}

export async function requireAdmin(): Promise<Learner> {
  const learner = await currentLearner();
  if (learner.role !== "admin") throw new Forbidden();
  return learner;
}
