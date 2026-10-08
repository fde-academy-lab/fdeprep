/**
 * The Voice page: every published question, and a way into each mode.
 *
 * Before this the header went straight to a session on whichever question
 * sorted first, and the session was filed under the docs/07 fixture whatever
 * the screen showed. Now the learner picks, and the session route resolves the
 * pick on the server.
 *
 * Ordered by track in docs/07 section 11's order and then by slug, which is
 * also the order Next question walks. Pressure is offered only where the
 * question has follow-ups to interrupt with, since without them it is guided
 * mode spending the weekly rehearsal allowance.
 */
import Link from "next/link";
import type { Metadata } from "next";
import { History, Keyboard, Mic } from "lucide-react";
import { allowanceFor, humanise, voiceScope } from "@/lib/policy/caps";
import { currentLearner } from "@/lib/session/current";
import { clock } from "@/lib/voice/clock";
import { consentState } from "@/lib/voice/consent";
import { publishedQuestions, VOICE_TRACK_ORDER, type PublishedQuestion } from "@/lib/voice/question";
import { voiceReadiness, type VoiceMode } from "@/lib/voice/start";
import { ButtonLink } from "@/components/ui/button";
import { DifficultyMeter } from "@/components/ui/difficulty";
import { EmptyState } from "@/components/ui/empty-state";
import { trackName } from "@/components/ui/tracks";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Voice" };

const MODE_NOTE: Record<VoiceMode, string> = {
  guided: "Five instruments while you speak.",
  unguided: "The clock and a microphone. The instruments come back in the debrief.",
  pressure: "Guided, and the interviewer cuts in twice.",
};

function heading(track: string): string {
  const name = trackName(track);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function left(allowance: { remaining: number; max: number | null; resetInS: number | null },
              period: string): string {
  if (allowance.max === null) return "No cap";
  if (allowance.remaining > 0) return `${allowance.remaining} of ${allowance.max} left ${period}`;
  return `None left. More in ${humanise(allowance.resetInS ?? 0)}`;
}

export default async function VoicePage() {
  const learner = await currentLearner();
  const [questions, consent, guided, unguided, pressure] = await Promise.all([
    publishedQuestions(),
    consentState(learner.enrolmentId),
    allowanceFor({ enrolmentId: learner.enrolmentId, scope: voiceScope("guided") }),
    allowanceFor({ enrolmentId: learner.enrolmentId, scope: voiceScope("unguided") }),
    allowanceFor({ enrolmentId: learner.enrolmentId, scope: voiceScope("pressure") }),
  ]);
  const readiness = voiceReadiness();
  const staff = learner.role !== "learner";

  const tracks = new Map<string, PublishedQuestion[]>();
  for (const question of questions) {
    tracks.set(question.track, [...(tracks.get(question.track) ?? []), question]);
  }
  const ordered = [...tracks.entries()].sort(([a], [b]) => {
    const rank = (track: string) => {
      const at = (VOICE_TRACK_ORDER as readonly string[]).indexOf(track);
      return at < 0 ? VOICE_TRACK_ORDER.length : at;
    };
    return rank(a) - rank(b);
  });

  return (
    <main className="mx-auto max-w-[1280px] px-4 pb-16 pt-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-display font-semibold tracking-[-0.02em] text-text">Voice</h1>
          <p className="mt-1 max-w-2xl text-text-dim">
            Answer out loud against the clock, or type the answer when you cannot speak. Every
            answer gets a debrief with the beats you covered and what a strong answer said.
          </p>
        </div>
        <ButtonLink href="/voice/sessions" variant="ghost"><History aria-hidden /> Past answers</ButtonLink>
      </div>

      <dl className="mt-6 grid gap-px overflow-hidden rounded-panel border border-border bg-border sm:grid-cols-3">
        {([["Guided", guided, "today"], ["Unguided", unguided, "today"],
           ["Pressure", pressure, "this week, shared with rehearsals"]] as const).map(([name, allowance, period]) => (
          <div key={name} className="bg-surface px-4 py-3">
            <dt className="text-meta text-text-faint">{name}</dt>
            <dd className="mt-0.5 text-text">{left(allowance, period)}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-meta text-text-faint">
        An answer you stop inside its first thirty seconds, before forty words, does not count.
      </p>

      {!readiness.ready ? (
        <p className="mt-6 rounded-panel border border-border bg-surface px-4 py-3 text-text-dim">
          Spoken answers are not switched on for this cohort yet, so a spoken run is timed
          practice that records nothing. A typed answer is scored now.
          {staff ? ` The web app needs ${readiness.missing.join(" and ")}; docs/05 has the steps.` : ""}
        </p>
      ) : !consent.granted ? (
        <p className="mt-6 rounded-panel border border-border bg-surface px-4 py-3 text-text-dim">
          A spoken answer is recorded, so it needs your consent once. A typed answer does not.{" "}
          <Link href="/voice/consent" className="text-text underline underline-offset-2">Read what is recorded</Link>
        </p>
      ) : null}

      {questions.length === 0 ? (
        <EmptyState icon={Mic} className="mt-8">
          {staff ? (
            <>No interview questions are published yet. Run <code className="font-mono text-text">npm run
            import:content</code> in <code className="font-mono text-text">web/</code> to load the ones
            in <code className="font-mono text-text">voice-questions/</code>.</>
          ) : "No interview questions are published yet. Ask your faculty to run the content import."}
        </EmptyState>
      ) : (
        <div className="mt-8 space-y-8">
          {ordered.map(([track, rows]) => (
            <section key={track} aria-labelledby={`track-${track}`}>
              <h2 id={`track-${track}`} className="text-meta font-medium uppercase tracking-wide text-text-faint">
                {heading(track)}
              </h2>
              <div className="mt-2 overflow-x-auto rounded-panel border border-border">
                {/* Fixed widths, so the five tables line up as one list. */}
                <table className="w-full min-w-[760px] table-fixed border-collapse text-left">
                  <colgroup>
                    <col />
                    <col className="w-32" />
                    <col className="w-20" />
                    <col className="w-[22rem]" />
                  </colgroup>
                  <thead className="bg-surface-2 text-meta text-text-faint">
                    <tr>
                      <th scope="col" className="px-4 py-2.5 font-medium">Question</th>
                      <th scope="col" className="px-4 py-2.5 font-medium">Difficulty</th>
                      <th scope="col" className="px-4 py-2.5 text-right font-medium">Clock</th>
                      <th scope="col" className="px-4 py-2.5 text-right font-medium">Answer it</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border bg-surface">
                    {rows.map((question) => (
                      <tr key={question.slug}>
                        <td className="px-4 py-3 font-medium text-text">{question.title}</td>
                        <td className="px-4 py-3"><DifficultyMeter difficulty={question.difficulty} /></td>
                        <td className="tnum px-4 py-3 text-right font-mono text-text-dim">
                          {clock(question.totalSeconds * 1000)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap justify-end gap-1.5">
                            {(["guided", "unguided", "pressure"] as const)
                              .filter((mode) => mode !== "pressure" || question.followUps > 0)
                              .map((mode) => (
                                <ButtonLink key={mode} size="sm" title={MODE_NOTE[mode]}
                                            variant={mode === "guided" ? "secondary" : "ghost"}
                                            href={{ pathname: "/voice/session", query: { q: question.slug, mode } }}>
                                  <span className="capitalize">{mode}</span>
                                </ButtonLink>
                              ))}
                            <ButtonLink size="sm" variant="ghost" title="Type the answer instead of speaking it."
                                        href={{ pathname: "/voice/session",
                                                query: { q: question.slug, mode: "guided", input: "typed" } }}>
                              <Keyboard aria-hidden /> Type
                            </ButtonLink>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
