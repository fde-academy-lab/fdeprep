/**
 * The debrief. docs/07 section 6.
 *
 * Five panels in the order that section draws them: the score line, the
 * beats, the territory the answer never entered, the judge's sentence, and
 * delivery marked not scored. Then the transcript, which is safe here because
 * the learner has stopped speaking.
 *
 * The delivery panel is the only place in the application that renders a
 * words-per-minute figure, a filler count or a pause length, and
 * tests/fairness.test.ts is what keeps it that way.
 *
 * A typed answer has no clock, so it has no replay, no pace, no delivery and
 * no recording, and the page says so rather than showing zeros.
 *
 * Who reads it is lib/session/records.ts: the learner, faculty of their
 * cohort and admins, since docs/07 section 9 and the consent screen promise
 * faculty the transcript and the score. Staff read it as it stands. The
 * recording controls and the links to answer again are the learner's, and
 * staff hear the recording only once the learner shares it (S15.13).
 */
import Link from "next/link";
import type { Metadata, Route } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/db/pool";
import { clock } from "@/lib/voice/clock";
import { DebriefNotFound, loadDebrief } from "@/lib/voice/debrief";
import { deliveryLine } from "@/lib/voice/delivery";
import { RETENTION_DAYS } from "@/lib/voice/audio";
import {
  CONTENT_WEIGHT, MAX_JUDGE_ATTEMPTS, PACE_WEIGHT, STRUCTURE_WEIGHT,
} from "@/lib/voice/score";
import { nextQuestionSlug } from "@/lib/voice/question";
import { PANEL, seatedFor } from "@/lib/voice/interviewers";
import type { DebriefRound } from "@/lib/voice/turns";
import { currentLearner } from "@/lib/session/current";
import { readableVoiceSession } from "@/lib/session/records";
import { ButtonLink } from "@/components/ui/button";
import { InterviewRoom } from "@/components/voice/room/room";
import { AudioControls } from "./controls";
import { Replay } from "./replay";

export const dynamic = "force-dynamic";

const PACE_LABEL: Record<string, string> = {
  on_budget: "on budget",
  stretching: "stretching",
  overrun: "overrun",
  never_reached: "never reached",
};

/**
 * The session the address names, when the signed-in viewer may read it, and
 * whether it is the viewer's own. Null for a session that does not exist and
 * for one the viewer may not read alike, so the two give the same 404.
 */
async function find(params: Promise<{ id: string }>) {
  const learner = await currentLearner();
  // An address with no session number in it names no session. Sent to the
  // database it was a type error and a 500.
  const sessionId = Number((await params).id);
  if (!Number.isSafeInteger(sessionId) || sessionId <= 0) return null;
  const owner = await readableVoiceSession(learner, sessionId);
  if (!owner) return null;
  return { learner, sessionId, owner, own: owner.enrolmentId === learner.enrolmentId };
}

/** The tab carries the question's title, for a session the viewer may read. */
export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> },
): Promise<Metadata> {
  const found = await find(params);
  if (!found) return { title: "Past answers" };
  const { rows } = await db().query<{ title: string }>(
    `select q.title from voice_session s join voice_question q on q.id = s.voice_question_id
      where s.id = $1`,
    [found.sessionId]);
  return { title: rows[0]?.title ?? "Past answers" };
}

export default async function DebriefPage({ params }: { params: Promise<{ id: string }> }) {
  const found = await find(params);
  if (!found) notFound();
  const { learner, sessionId, owner, own } = found;

  // Faculty and admins also see how each follow-up round was made. The
  // learner sees who asked and what, in one voice.
  const staff = learner.role !== "learner";
  let debrief;
  try {
    debrief = await loadDebrief(sessionId, owner.enrolmentId, { staff });
  } catch (error) {
    if (error instanceof DebriefNotFound) notFound();
    throw error;
  }
  // The learner hears their own recording. Anyone else hears it only once the
  // learner has shared this session, which the audio route checks again.
  const audible = debrief.audio.available && (own || debrief.audio.shared);
  const seated = debrief.interviewer ? await seatedFor(debrief.interviewer.slug) : [];

  const typed = debrief.input === "typed";
  const next = await nextQuestionSlug(debrief.question.slug);
  const labels = new Map(debrief.question.beats.map((beat) => [beat.key, beat.label]));
  const furtherBeats = debrief.depth.filter((beat) => beat.missing.length > 0);

  const replayBeats = debrief.beats.map((beat) => {
    const authored = debrief.question.beats.find((candidate) => candidate.key === beat.key);
    return { ...beat, anchors: authored?.anchors ?? [], seconds: authored?.seconds ?? 60 };
  });
  // Answer it again with the same interviewer. A slug the lobby no longer
  // knows falls back there to the question's first.
  const again = new URLSearchParams({ q: debrief.question.slug, mode: debrief.mode });
  if (debrief.interviewer) again.set("interviewer", debrief.interviewer.slug);

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <p className="text-text-dim">
        <Link href="/voice/sessions" className="text-accent">Past answers</Link>
      </p>
      <h1 className="mt-2 text-xl font-semibold">{debrief.question.title}</h1>
      <p className="mt-1 text-text-dim">
        <span className="capitalize">{debrief.mode}</span>
        {typed ? " · typed, so there is no clock, pace or recording" : ` · ${clock(debrief.durationMs)}`}
      </p>
      {debrief.interviewer ? (
        <p className="mt-1 text-text-dim">
          {debrief.interviewer.slug === PANEL
            ? `Asked by the panel: ${namesInOrder(seated.map((person) => person.name))}.`
            : `Asked by ${debrief.interviewer.name}, ${debrief.interviewer.title}.`}
        </p>
      ) : null}
      {seated.length > 0 ? (
        <div className="mt-4 w-fit overflow-hidden rounded-panel border border-border bg-surface">
          <InterviewRoom size="debrief"
                         interviewers={seated.map((person) => ({ slug: person.slug, name: person.name,
                                                                 role: person.title }))} />
        </div>
      ) : null}
      {own ? (
        <div className="mt-4 flex flex-wrap gap-2.5">
          <ButtonLink href={`/voice/session?${again.toString()}` as Route} size="sm">
            Answer it again
          </ButtonLink>
          {next && next !== debrief.question.slug ? (
            <ButtonLink href={`/voice/session?q=${next}&mode=${debrief.mode}`} size="sm" variant="ghost">
              Next question
            </ButtonLink>
          ) : null}
          <ButtonLink href="/voice" size="sm" variant="ghost">All questions</ButtonLink>
        </div>
      ) : null}

      <section className="results-pane mt-6 border border-border bg-surface p-4">
        {debrief.scored && debrief.score ? (
          <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
            <span className="text-2xl font-semibold tnum">Score {Math.round(debrief.score.total)}</span>
            <Axis label="Content" points={debrief.score.content} outOf={CONTENT_WEIGHT} />
            <Axis label="Structure" points={debrief.score.structure} outOf={STRUCTURE_WEIGHT} />
            {debrief.score.pace === null ? (
              <span className="text-text-dim">Pace not scored, because a typed answer has no clock</span>
            ) : (
              <Axis label="Pace" points={debrief.score.pace} outOf={PACE_WEIGHT} />
            )}
          </div>
        ) : debrief.judgeGaveUp ? (
          <p className="text-text-dim">
            The judge could not score this answer after {MAX_JUDGE_ATTEMPTS} tries, so it did not
            count against your allowance. Answer it again when you are ready.
          </p>
        ) : debrief.notCounted ? (
          <p className="text-text-dim">
            This answer ended inside its first thirty seconds, before forty words, so it was not
            scored and did not count against your allowance.
          </p>
        ) : (
          <p className="text-text-dim">
            {typed
              ? "Scoring has not run yet. The score and which beats you covered arrive when the judge has read your answer; reload this page then."
              : "Scoring has not run yet. The replay and your delivery numbers are below; the score and which beats you covered arrive when the judge has read the transcript."}
          </p>
        )}
      </section>

      {typed ? null : (
        <div className="mt-6">
          <Replay
            beats={replayBeats}
            nudges={debrief.nudges}
            durationMs={debrief.durationMs}
            audioUrl={audible ? `/api/voice/sessions/${debrief.sessionId}/audio` : null}
            showsNudges={debrief.mode !== "unguided"}
          />
        </div>
      )}

      <Panel title="Beats">
        <table className="w-full text-left tnum">
          <tbody className="divide-y divide-border">
            {debrief.beats.map((beat) => (
              <tr key={beat.key}>
                <td className="py-1.5 font-mono text-text-faint">{beat.key}</td>
                <td className="py-1.5">{beat.label}</td>
                {/* Covered is the judge's answer, so before the judge has run it
                    is not an answer at all, and every beat reading "missed" said
                    so wrongly. */}
                <td className={`py-1.5 ${!debrief.scored ? "text-text-faint" : beat.covered ? "text-pass" : "text-fail"}`}>
                  {debrief.notCounted ? "not judged" : !debrief.scored ? "not judged yet"
                    : beat.covered ? "covered" : "missed"}
                </td>
                {typed ? null : (
                  <>
                    <td className="py-1.5 text-right text-text-dim">
                      {beat.reachedAtMs === null ? "--" : clock(beat.spentMs)}
                    </td>
                    <td className="py-1.5 text-right text-text-dim">
                      {PACE_LABEL[beat.paceState] ?? beat.paceState}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {!typed && debrief.scored && debrief.beats.some((beat) => beat.covered !== beat.liveCovered) && (
          <p className="mt-3 text-text-faint">
            The cockpit and the judge disagreed on{" "}
            {debrief.beats
              .filter((beat) => beat.covered !== beat.liveCovered)
              .map((beat) => beat.key)
              .join(", ")}
            . The live cues match words; the judge reads the answer, and the judge decides
            the score.
          </p>
        )}
      </Panel>

      {furtherBeats.length > 0 && (
        <Panel title="Territory not entered">
          <p className="text-text-faint">
            The words a strong answer used at each beat that yours did not, and the sentence it
            used them in.
          </p>
          <ol className="mt-4 space-y-4">
            {furtherBeats.map((beat) => (
              <li key={beat.key}>
                <p className="text-text">
                  <span className="font-mono text-text-faint">{beat.key}</span>{" "}
                  {labels.get(beat.key) ?? beat.key}
                </p>
                <p className="mt-1 text-text-dim">
                  {beat.named.length > 0 ? `You named ${beat.named.join(", ")}. ` : ""}
                  A strong answer also named {beat.missing.join(", ")}.
                </p>
                {beat.strongLine ? (
                  <blockquote className="mt-1.5 border-l-2 border-border-strong pl-3 text-text-dim">
                    {beat.strongLine}
                  </blockquote>
                ) : null}
              </li>
            ))}
          </ol>
        </Panel>
      )}

      {debrief.judgeSummary && (
        <Panel title="Judge">
          <p className="text-text-dim">{debrief.judgeSummary}</p>
        </Panel>
      )}

      {/* docs/07 section 5a: who asked what, in plain words. A round from
          the resume says it was not scored. */}
      {debrief.rounds.length > 0 ? (
        <Panel title="Interview">
          <ol className="space-y-4">
            {debrief.rounds.map((round) => (
              <li key={round.ordinal}>
                <p className="flex flex-wrap items-baseline gap-x-3">
                  <span className="font-mono text-text-faint">{round.ordinal}</span>
                  <span className="text-text">{round.interviewer.name}</span>
                  <span className="text-meta text-text-faint">{round.kindLabel}</span>
                </p>
                <blockquote className="mt-1 border-l-2 border-border-strong pl-3 text-text">
                  {round.question}
                </blockquote>
                <p className="mt-1 whitespace-pre-wrap text-text-dim">
                  {round.answer ? round.answer : "You did not reply to this one."}
                </p>
                {round.staff ? (
                  <p className="mt-1 text-meta text-text-faint">{provenance(round.staff)}</p>
                ) : null}
              </li>
            ))}
          </ol>
        </Panel>
      ) : null}

      {/*
        docs/07 section 6: reported, never scored. The label is part of the
        panel rather than a footnote, because a number on a debrief with no
        label on it reads as a number that counts.
      */}
      {debrief.delivery ? (
        <Panel title="Delivery (not scored)">
          <p className="text-text-dim">{deliveryLine(debrief.delivery)}</p>
          <p className="mt-2 text-text-faint">
            These three are here because you may want to work on them. They are not in your
            score, not in your competencies, and not in anything the placement side reads.
          </p>
        </Panel>
      ) : null}

      <Panel title={typed ? (own ? "Your answer" : "The answer") : "Transcript"}>
        <p className="whitespace-pre-wrap text-text-dim">
          {debrief.transcript || "Nothing was transcribed."}
        </p>
      </Panel>

      {typed ? null : own ? (
        <Panel title="Your recording">
          <AudioControls
            sessionId={debrief.sessionId}
            available={debrief.audio.available}
            deletedAt={debrief.audio.deletedAt}
            shared={debrief.audio.shared}
            retentionDays={RETENTION_DAYS}
          />
        </Panel>
      ) : (
        <Panel title="Recording">
          <p className="text-text-dim">{recordingForStaff(debrief.audio)}</p>
        </Panel>
      )}
    </main>
  );
}

/**
 * What faculty read where the learner reads their recording controls. The
 * share is the learner's to give (docs/07 section 9), so the next action
 * named is asking for it.
 */
function recordingForStaff(audio: { available: boolean; deletedAt: string | null; shared: boolean }): string {
  if (audio.deletedAt) return "The learner deleted this recording. The transcript and the score stay.";
  if (!audio.available) return "No recording was stored for this session. The replay above runs on its own clock.";
  if (audio.shared) return "The learner shared this recording with faculty, and it plays in the replay above.";
  return "The learner has not shared this recording. Ask them to share it from their debrief if you need to hear it.";
}

/** "A, B and C", the way the panel's members are named in a sentence. */
function namesInOrder(names: string[]): string {
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** For faculty: how a round was made and how long each step took. */
function provenance(staff: NonNullable<DebriefRound["staff"]>): string {
  const ms = (value: number | null) => (value === null ? "none" : `${(value / 1000).toFixed(1)}s`);
  const made = staff.source === "generated" ? "asked by the model"
    : `${staff.source === "authored" ? "an authored follow-up" : "the interviewer's own probe"}` +
      `${staff.fallbackReason ? `, because the model ${FALLBACK[staff.fallbackReason] ?? staff.fallbackReason}` : ""}`;
  return `Faculty only: ${made}. Generation ${ms(staff.generationMs)}, speech ${ms(staff.synthesisMs)}, ` +
    `gap ${ms(staff.gapMs)}.${staff.targets ? ` Pulled on: ${staff.targets}` : ""}`;
}

const FALLBACK: Record<string, string> = {
  timeout: "was late",
  error: "failed",
  rejected: "answered with something the check refused",
};

function Axis({ label, points, outOf }: { label: string; points: number; outOf: number }) {
  return (
    <span className="text-text-dim">
      {label} <span className="text-text tnum">{Math.round(points)}/{outOf}</span>
    </span>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 border border-border bg-surface p-4">
      <h2 className="text-meta font-medium text-text-faint">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}
