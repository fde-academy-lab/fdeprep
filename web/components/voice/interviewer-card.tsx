/**
 * Who is about to ask the question, in the lobby. docs/07 section 2a.
 *
 * Name, label, the role sentence, what they listen for, and their opening
 * line. With speech configured the opening line and the question are heard in
 * the interviewer's own voice; without it the opening line is written out,
 * because an interviewer nobody can hear still has something to say. Drawn
 * before an answer starts and never during one: the cockpit receives the
 * lobby and hides it while the learner speaks.
 */
import type { Interviewer } from "@/lib/voice/interviewers";
import { HearButton } from "./hear-button";

export function InterviewerCard({ interviewer, questionId, speaks }: {
  interviewer: Interviewer;
  questionId: number;
  /** Whether a bucket is configured, so the lines can be synthesised. */
  speaks: boolean;
}) {
  const speech = `/api/voice/questions/${questionId}/speech/${encodeURIComponent(interviewer.slug)}`;
  return (
    <section aria-label="Your interviewer" className="rounded-panel border border-border bg-surface p-5">
      <p className="text-meta text-text-faint">Your interviewer</p>
      <h2 className="mt-1 text-lead font-semibold text-text">
        {interviewer.name}, <span className="font-normal text-text-dim">{interviewer.title}</span>
      </h2>
      <p className="mt-1 max-w-[70ch] text-text-dim">{interviewer.role}</p>
      <h3 className="mt-4 text-meta font-medium text-text-faint">Listens for</h3>
      <ul className="mt-1.5 list-disc space-y-1 pl-5 text-text-dim">
        {interviewer.listensFor.map((line) => <li key={line}>{line}</li>)}
      </ul>
      <div className="mt-4">
        {speaks ? (
          <HearButton urls={[`${speech}/opening`, `${speech}/prompt`]} label="Hear the question"
                      fallback={interviewer.openingLine} />
        ) : (
          <blockquote className="border-l-2 border-border-strong pl-3 text-text-dim">
            {interviewer.openingLine}
          </blockquote>
        )}
      </div>
    </section>
  );
}
