/**
 * S10 Roster: cohort members, persona, enrolment state, last activity, the
 * bulk persona change from a CSV upload, and, for admins, the invites that let
 * a tester in (docs/01 section S10, amended 30 September 2026).
 *
 * Faculty get the table and no buttons. Both actions write, and both routes
 * are admin only.
 */
import type { Metadata } from "next";
import { Ticket, Users } from "lucide-react";
import { roster } from "@/lib/admin";
import { listInvites } from "@/lib/auth/invite";
import { currentLearner } from "@/lib/session/current";
import { relativeDay } from "@/lib/progress/summary";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeading, SectionHeading } from "@/components/ui/page";
import { Cell, Head, Row, Table } from "@/components/ui/table";
import { PersonaUpload } from "./upload";
import { InviteDialog, Withdraw } from "./invites";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Roster" };

/** The product's one date form, 8 Oct 2026, read in UTC as the invite was written. */
const date = (iso: string) => new Date(iso).toLocaleDateString("en-GB",
  { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export default async function RosterPage() {
  const learner = await currentLearner();
  const admin = learner.role === "admin";
  const rows = await roster(learner.cohortId);
  const invites = admin ? await listInvites(learner.cohortId) : [];
  // Staff are on the roster too, so "nobody enrolled" means no learner yet.
  const learners = rows.filter((row) => row.role === "learner").length;
  // One Invite a tester on screen: the empty state's while there is no learner,
  // the heading row's after that. Faculty cannot invite, so they get neither.
  const invite = admin ? <InviteDialog size={learners ? "md" : "sm"} /> : null;

  return (
    <>
      <PageHeading title="Roster" action={admin ? (
        <div className="flex items-center gap-2">
          <PersonaUpload />
          {learners ? invite : null}
        </div>
      ) : undefined} />

      {learners === 0 ? (
        <EmptyState icon={Users} action={invite}>
          Nobody is enrolled in this cohort yet. Invite the first tester.
        </EmptyState>
      ) : (
        <Table head={
          <Head>
            <Cell head>Login</Cell>
            <Cell head>Name</Cell>
            <Cell head>Persona</Cell>
            <Cell head>Role</Cell>
            <Cell head>State</Cell>
            <Cell head>Last activity</Cell>
          </Head>
        }>
          {rows.map((row) => (
            <Row key={row.enrolmentId}>
              <Cell className="font-medium text-text">{row.login}</Cell>
              <Cell className="text-text-dim">{row.displayName}</Cell>
              <Cell className="capitalize text-text-dim">{row.persona}</Cell>
              <Cell className="text-text-dim">{row.role}</Cell>
              <Cell className="text-text-dim">{row.state}</Cell>
              <Cell className="whitespace-nowrap text-text-dim">
                {row.lastActivity ? relativeDay(row.lastActivity) : "never"}
              </Cell>
            </Row>
          ))}
        </Table>
      )}

      {admin ? (
        <section aria-labelledby="invites">
          <SectionHeading id="invites" title="Invites" />
          {invites.length ? (
            <Table className="mt-4" head={
              <Head>
                <Cell head>For</Cell>
                <Cell head>Login</Cell>
                <Cell head>Role</Cell>
                <Cell head>Persona</Cell>
                <Cell head>State</Cell>
                <Cell head>Expires</Cell>
                <Cell head>Used by</Cell>
                <Cell head><span className="sr-only">Action</span></Cell>
              </Head>
            }>
              {invites.map((invite) => (
                <Row key={invite.id}>
                  <Cell className="text-text">{invite.note ?? "no note"}</Cell>
                  <Cell className="text-text-dim">{invite.githubLogin ?? "anyone with the link"}</Cell>
                  <Cell className="text-text-dim">{invite.role}</Cell>
                  <Cell className="capitalize text-text-dim">{invite.persona}</Cell>
                  <Cell className="text-text">{invite.state}</Cell>
                  <Cell className="whitespace-nowrap text-text-dim">{date(invite.expiresAt)}</Cell>
                  <Cell className="text-text-dim">{invite.usedByLogin ?? ""}</Cell>
                  <Cell className="py-0.5! text-right">
                    {invite.state === "pending" ? <Withdraw inviteId={invite.id} /> : null}
                  </Cell>
                </Row>
              ))}
            </Table>
          ) : (
            <EmptyState icon={Ticket} className="mt-4">
              No invites yet. Make a link and send it to the tester yourself.
            </EmptyState>
          )}
        </section>
      ) : null}
    </>
  );
}
