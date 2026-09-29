/**
 * S10 Roster: cohort members, persona, enrolment state, last activity, and the
 * bulk persona change from a CSV upload.
 */
import Nav from "./upload";
import { roster } from "@/lib/admin";
import { currentLearner } from "@/lib/session/current";
import { relativeDay } from "@/lib/progress/summary";

export const dynamic = "force-dynamic";

export default async function RosterPage() {
  const learner = await currentLearner();
  const rows = await roster(learner.cohortId);

  return (
    <main className="px-4 py-4">
      <h1 className="mb-3">Roster</h1>

      {learner.role === "admin" ? <Nav /> : (
        <p className="mb-4 text-text-dim">Faculty see the roster read-only.</p>
      )}

      <table className="w-full text-left">
        <thead>
          <tr className="text-text-dim">
            {["Login", "Name", "Persona", "Role", "State", "Last activity"].map((head) => (
              <th key={head} scope="col" className="py-1 pr-4 font-normal">{head}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.enrolmentId} className="border-t border-border">
              <td className="py-2 pr-4">{row.login}</td>
              <td className="py-2 pr-4 text-text-dim">{row.displayName}</td>
              <td className="py-2 pr-4 capitalize">{row.persona}</td>
              <td className="py-2 pr-4 text-text-dim">{row.role}</td>
              <td className="py-2 pr-4 text-text-dim">{row.state}</td>
              <td className="py-2 text-text-dim">
                {row.lastActivity ? relativeDay(row.lastActivity) : "never"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 ? (
        <p className="py-4 text-text-dim">
          Nobody is enrolled in this cohort yet. Import the roster before the cohort starts.
        </p>
      ) : null}
    </main>
  );
}
