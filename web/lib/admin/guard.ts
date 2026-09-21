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

/**
 * The role check on its own, so who may do what is testable without a session.
 *
 * The guards below read the role from the session and then ask this. Keeping
 * the decision separate from where the role came from is what lets a test say
 * "faculty may settle a disagreement and may not touch ops" in one line.
 */
export function permits(role: Learner["role"], level: "admin" | "faculty"): boolean {
  if (role === "admin") return true;
  return level === "faculty" && role === "faculty";
}

export async function requireAdmin(): Promise<Learner> {
  const learner = await currentLearner();
  if (!permits(learner.role, "admin")) throw new Forbidden();
  return learner;
}

/**
 * Faculty or admin, for the actions that are faculty's job.
 *
 * Adjudicating a panel disagreement is the one docs/10 section 9.7 names, and
 * it is faculty work rather than operations: the question is whether an answer
 * was graded correctly, which is what faculty are for. This widens who may
 * write a review and nothing else. It does not open the ops actions, the
 * roster, the import screen or anything that moves a counter or a grade.
 */
export async function requireFaculty(): Promise<Learner> {
  const learner = await currentLearner();
  if (!permits(learner.role, "faculty")) throw new Forbidden();
  return learner;
}
