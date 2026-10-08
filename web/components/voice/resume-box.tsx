"use client";

/**
 * Where a learner pastes a resume for interview mode. docs/07 section 9, as
 * amended for S14.2.
 *
 * Before the answer starts and never during one: the cockpit draws it only
 * while no answer runs. It holds the text in the cockpit's state until Start
 * sends it once, and the server reads it, turns it into claims and keeps
 * nothing else. The rule's first sentence is repeated above the box, where the
 * learner acts on it, and the consent screen has the rest.
 */
import { RESUME_MAX_CHARS, RESUME_RULE } from "@/lib/voice/resume-rule";

export function ResumeBox({ value, onChange }: { value: string; onChange: (text: string) => void }) {
  const over = value.length - RESUME_MAX_CHARS;
  return (
    <section aria-label="Your resume" className="border border-border bg-surface p-4">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="font-medium">Your resume, if you want it asked about</h2>
        <span className="tnum text-meta text-text-faint">
          {value.length.toLocaleString("en-GB")} of {RESUME_MAX_CHARS.toLocaleString("en-GB")} characters
        </span>
      </div>
      <p className="mt-1 text-text-dim">
        {RESUME_RULE} It is read once, never saved, and never used in your score.
      </p>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={5}
        spellCheck={false}
        aria-label="Paste your resume"
        placeholder="Paste your resume here, or leave this empty."
        className="mt-3 w-full resize-y rounded-control border border-border-control bg-bg px-3 py-2
                   text-text placeholder:text-text-faint"
      />
      {over > 0 ? (
        <p className="mt-2 text-warn" role="alert">
          This is {over.toLocaleString("en-GB")} characters over the limit. Cut it to the parts about
          your work, or the session will not start.
        </p>
      ) : null}
    </section>
  );
}
