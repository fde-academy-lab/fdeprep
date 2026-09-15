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
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { clock } from "@/lib/voice/clock";
import { DebriefNotFound, loadDebrief } from "@/lib/voice/debrief";
import { deliveryLine } from "@/lib/voice/delivery";
import { RETENTION_DAYS } from "@/lib/voice/audio";
import { CONTENT_WEIGHT, PACE_WEIGHT, STRUCTURE_WEIGHT } from "@/lib/voice/score";
import { currentLearner } from "@/lib/session/current";
import { AudioControls } from "./controls";
import { Replay } from "./replay";

export const dynamic = "force-dynamic";

const PACE_LABEL: Record<string, string> = {
  on_budget: "on budget",
  stretching: "stretching",
  overrun: "overrun",
  never_reached: "never reached",
};

export default async function DebriefPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const learner = await currentLearner();

  let debrief;
  try {
    debrief = await loadDebrief(Number(id), learner.enrolmentId);
  } catch (error) {
    if (error instanceof DebriefNotFound) notFound();
    throw error;
  }

  const replayBeats = debrief.beats.map((beat) => {
    const authored = debrief.question.beats.find((candidate) => candidate.key === beat.key);
    return { ...beat, anchors: authored?.anchors ?? [], seconds: authored?.seconds ?? 60 };
  });

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <p className="text-text-dim">
        <Link href="/voice/sessions" className="text-accent">Past answers</Link>
      </p>
      <h1 className="mt-2 text-xl font-semibold">{debrief.question.title}</h1>
      <p className="mt-1 capitalize text-text-dim">
        {debrief.mode} · {clock(debrief.durationMs)}
      </p>

      <section className="results-pane mt-6 border border-border bg-surface p-4">
        {debrief.scored && debrief.score ? (
          <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
            <span className="text-2xl font-semibold tnum">Score {Math.round(debrief.score.total)}</span>
            <Axis label="Content" points={debrief.score.content} outOf={CONTENT_WEIGHT} />
            <Axis label="Structure" points={debrief.score.structure} outOf={STRUCTURE_WEIGHT} />
            <Axis label="Pace" points={debrief.score.pace} outOf={PACE_WEIGHT} />
          </div>
        ) : (
          <p className="text-text-dim">
            Scoring has not run yet. The beats, the replay and your delivery numbers are
            below; the score arrives when the judge has read the transcript.
          </p>
        )}
      </section>

      <div className="mt-6">
        <Replay
          beats={replayBeats}
          nudges={debrief.nudges}
          durationMs={debrief.durationMs}
          audioUrl={debrief.audio.available ? `/api/voice/sessions/${debrief.sessionId}/audio` : null}
          showsNudges={debrief.mode !== "unguided"}
        />
      </div>

      <Panel title="Beats">
        <table className="w-full text-left tnum">
          <tbody className="divide-y divide-border">
            {debrief.beats.map((beat) => (
              <tr key={beat.key}>
                <td className="py-1.5 font-mono text-text-faint">{beat.key}</td>
                <td className="py-1.5">{beat.label}</td>
                <td className={`py-1.5 ${beat.covered ? "text-pass" : "text-fail"}`}>
                  {beat.covered ? "covered" : "missed"}
                </td>
                <td className="py-1.5 text-right text-text-dim">
                  {beat.reachedAtMs === null ? "--" : clock(beat.spentMs)}
                </td>
                <td className="py-1.5 text-right text-text-dim">
                  {PACE_LABEL[beat.paceState] ?? beat.paceState}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {debrief.beats.some((beat) => beat.covered !== beat.liveCovered) && (
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

      {debrief.territoryNotEntered.length > 0 && (
        <Panel title="Territory not entered">
          <p className="text-text-dim">{debrief.territoryNotEntered.join(" · ")}</p>
        </Panel>
      )}

      {debrief.judgeSummary && (
        <Panel title="Judge">
          <p className="text-text-dim">{debrief.judgeSummary}</p>
        </Panel>
      )}

      {/*
        docs/07 section 6: reported, never scored. The label is part of the
        panel rather than a footnote, because a number on a debrief with no
        label on it reads as a number that counts.
      */}
      <Panel title="Delivery (not scored)">
        <p className="text-text-dim">{deliveryLine(debrief.delivery)}</p>
        <p className="mt-2 text-text-faint">
          These three are here because you may want to work on them. They are not in your
          score, not in your competencies, and not in anything the placement side reads.
        </p>
      </Panel>

      <Panel title="Transcript">
        <p className="whitespace-pre-wrap text-text-dim">
          {debrief.transcript || "Nothing was transcribed."}
        </p>
      </Panel>

      <Panel title="Your recording">
        <AudioControls
          sessionId={debrief.sessionId}
          available={debrief.audio.available}
          deletedAt={debrief.audio.deletedAt}
          shared={debrief.audio.shared}
          retentionDays={RETENTION_DAYS}
        />
      </Panel>
    </main>
  );
}

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
      <h2 className="text-xs uppercase tracking-wide text-text-faint">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}
