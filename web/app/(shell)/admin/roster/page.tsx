/**
 * S10 Roster: cohort members, persona, enrolment state, last activity, the
 * bulk persona change from a CSV upload, and, for admins, the invites that let
 * a tester in (docs/01 section S10, amended 30 September 2026).
 */
import type { Metadata } from "next";
import Nav from "./upload";
import { InviteForm, Withdraw } from "./invites";
import { roster } from "@/lib/admin";
import { listInvites } from "@/lib/auth/invite";
import { currentLearner } from "@/lib/session/current";
import { relativeDay } from "@/lib/progress/summary";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Roster" };

export default async function RosterPage() {
  const learner = await currentLearner();
  const rows = await roster(learner.cohortId);
  const invites = learner.role === "admin" ? await listInvites(learner.cohortId) : [];

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
          Nobody is enrolled in this cohort yet. Invite the first tester below.
        </p>
      ) : null}

      {learner.role === "admin" ? (
        <section className="mt-8">
          <h2 className="mb-3">Invites</h2>
          <InviteForm />
          <table className="w-full text-left">
            <thead>
              <tr className="text-text-dim">
                {["For", "Login", "Role", "Persona", "State", "Expires", "Used by", ""].map((head) => (
                  <th key={head || "action"} scope="col" className="py-1 pr-4 font-normal">{head}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {invites.map((invite) => (
                <tr key={invite.id} className="border-t border-border">
                  <td className="py-2 pr-4">{invite.note ?? "no note"}</td>
                  <td className="py-2 pr-4 text-text-dim">{invite.githubLogin ?? "anyone with the link"}</td>
                  <td className="py-2 pr-4 text-text-dim">{invite.role}</td>
                  <td className="py-2 pr-4 capitalize text-text-dim">{invite.persona}</td>
                  <td className="py-2 pr-4">{invite.state}</td>
                  <td className="py-2 pr-4 text-text-dim tnum">{invite.expiresAt.slice(0, 10)}</td>
                  <td className="py-2 pr-4 text-text-dim">{invite.usedByLogin ?? ""}</td>
                  <td className="py-2">
                    {invite.state === "pending" ? <Withdraw inviteId={invite.id} /> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {invites.length === 0 ? (
            <p className="py-4 text-text-dim">
              No invites yet. Make a link above and send it to the tester yourself.
            </p>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
