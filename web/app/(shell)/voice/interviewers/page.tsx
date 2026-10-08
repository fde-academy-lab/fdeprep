/**
 * The nine interviewers, to read before choosing one. docs/07 section 2a.
 *
 * Each is an object a learner acts on, so each gets a panel (docs/08 section
 * 6): who they are, what they listen for, the questions they ask, and a link
 * to the picker filtered to those questions. Everything comes from the
 * imported rows; nothing here names a voice or a probe, which stay on the
 * server and are heard rather than read.
 */
import Link from "next/link";
import type { Metadata } from "next";
import { Users } from "lucide-react";
import { currentLearner } from "@/lib/session/current";
import { loadInterviewers, PANEL, type Interviewer } from "@/lib/voice/interviewers";
import { publishedQuestions } from "@/lib/voice/question";
import { ButtonLink } from "@/components/ui/button";
import { InterviewerAvatar } from "@/components/voice/room/avatar";
import { InterviewRoom } from "@/components/voice/room/room";
import { EmptyState } from "@/components/ui/empty-state";
import { Page, PageHeading } from "@/components/ui/page";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Interviewers" };

export default async function InterviewersPage() {
  await currentLearner();
  const [interviewers, questions] = await Promise.all([loadInterviewers(), publishedQuestions()]);
  const names = new Map(interviewers.map((interviewer) => [interviewer.slug, interviewer.name]));
  const bySlug = new Map(interviewers.map((interviewer) => [interviewer.slug, interviewer]));
  /** Who sits at the table: the person, or the panel's members. */
  const seats = (interviewer: Interviewer) =>
    (interviewer.members.length > 0
      ? interviewer.members.map((slug) => bySlug.get(slug)).filter((person) => person !== undefined)
      : [interviewer]).map((person) => ({ slug: person.slug, name: person.name, role: person.title }));

  return (
    <Page>
      <PageHeading title="Interviewers"
                   line="Pick who asks. Each one listens for different things and follows up in their own way."
                   action={<Link href="/voice" className="text-text-dim hover:text-text">All questions</Link>} />

      {interviewers.length === 0 ? (
        <EmptyState icon={Users}>
          No interviewers are published yet. Ask your faculty to run the content import.
        </EmptyState>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {interviewers.map((interviewer) => {
            const asks = questions.filter((question) => question.interviewers.includes(interviewer.slug));
            return (
              <li key={interviewer.slug} className="flex flex-col rounded-panel border border-border bg-surface p-5">
                {/* The room is content: the interviewer at the table, as the
                    lobby will show them. The wall is the page's own colour,
                    so it sits apart inside the card. */}
                <div className="mb-4 w-fit overflow-hidden rounded-control border border-border">
                  <InterviewRoom size="debrief" interviewers={seats(interviewer)} />
                </div>
                <h2 className="flex items-center gap-2 text-lead font-semibold text-text">
                  <InterviewerAvatar slug={interviewer.slug} />
                  <span>
                    {interviewer.slug === PANEL ? interviewer.name : (
                      <>{interviewer.name}, <span className="font-normal text-text-dim">{interviewer.title}</span></>
                    )}
                  </span>
                </h2>
                <p className="mt-1 text-text-dim">{interviewer.role}</p>
                {interviewer.slug === PANEL && interviewer.members.length > 0 ? (
                  <p className="mt-1 text-text-faint">
                    {interviewer.members.map((slug) => names.get(slug) ?? slug).join(", ")}, chair first.
                  </p>
                ) : null}
                <h3 className="mt-4 text-meta font-medium text-text-faint">Listens for</h3>
                <ul className="mt-1.5 list-disc space-y-1 pl-5 text-text-dim">
                  {interviewer.listensFor.map((line) => <li key={line}>{line}</li>)}
                </ul>
                <h3 className="mt-4 text-meta font-medium text-text-faint">Asks</h3>
                {asks.length === 0 ? (
                  <p className="mt-1.5 text-text-faint">No published question names this interviewer yet.</p>
                ) : (
                  <ul className="mt-1.5 space-y-1">
                    {asks.map((question) => (
                      <li key={question.slug}>
                        <Link href={{ pathname: "/voice/session",
                                      query: { q: question.slug, interviewer: interviewer.slug } }}
                              className="text-text hover:text-accent">
                          {question.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-auto pt-4">
                  <ButtonLink href={{ pathname: "/voice", query: { interviewer: interviewer.slug } }} size="sm">
                    {`Answer ${interviewer.slug === PANEL ? "the panel" : interviewer.name.split(" ")[0]}'s questions`}
                  </ButtonLink>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Page>
  );
}
