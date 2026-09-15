"use client";

/**
 * Instrument replay. docs/07 section 4.
 *
 * "After an unguided run, the debrief replays the answer with the cockpit
 * turned on: the beat track filling in real time against the recorded audio,
 * the pace band changing as it changed, the nudges that would have fired
 * appearing where they would have fired. The learner sees their own answer
 * through the instruments they did not have."
 *
 * It replays stored facts rather than recomputing them, which is what makes
 * it honest: the beat times, the pace states and the nudge timestamps are the
 * ones the cockpit produced at the time, so a learner sees what happened
 * rather than what would happen now.
 *
 * The clock is the audio element's currentTime when there is a recording and
 * a plain timer when there is not. That matters twice over: on a machine with
 * no bucket configured, and thirty days later when docs/07 section 9 has
 * deleted the audio and the replay has to keep working, because the lesson
 * outlives the recording.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { BeatTrack, NudgeSlot, PaceBand, Territory } from "../../session/instruments";
import { clock } from "@/lib/voice/clock";
import type { PaceState } from "@/lib/voice/cues";
import type { DebriefBeat, DebriefNudge } from "@/lib/voice/debrief";

/** How long a nudge stays in the slot during replay. The same eight seconds
 *  the cockpit uses, so the replay shows what the learner would have seen. */
const NUDGE_LIFETIME_MS = 8_000;

const TICK_MS = 100;

export type ReplayBeat = DebriefBeat & { anchors: string[]; seconds: number };

export function Replay({
  beats,
  nudges,
  durationMs,
  audioUrl,
  showsNudges,
}: {
  beats: ReplayBeat[];
  nudges: DebriefNudge[];
  durationMs: number;
  audioUrl: string | null;
  /** False for an unguided run, where the nudges were computed and never
   *  shown. The replay shows them anyway and says so: that is the teaching. */
  showsNudges: boolean;
}) {
  const [atMs, setAtMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAt = useRef(0);

  const stop = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    audio.current?.pause();
    setPlaying(false);
  }, []);

  const play = useCallback(() => {
    if (playing) return stop();
    setPlaying(true);
    if (atMs >= durationMs) setAtMs(0);

    if (audio.current) {
      if (atMs >= durationMs) audio.current.currentTime = 0;
      void audio.current.play();
    }
    startedAt.current = Date.now() - (atMs >= durationMs ? 0 : atMs);
    timer.current = setInterval(() => {
      const next = audio.current
        ? audio.current.currentTime * 1000
        : Date.now() - startedAt.current;
      if (next >= durationMs) {
        setAtMs(durationMs);
        if (timer.current) clearInterval(timer.current);
        timer.current = null;
        setPlaying(false);
        return;
      }
      setAtMs(next);
    }, TICK_MS);
  }, [atMs, durationMs, playing, stop]);

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
  }, []);

  const scrub = useCallback((to: number) => {
    setAtMs(to);
    if (audio.current) audio.current.currentTime = to / 1000;
    startedAt.current = Date.now() - to;
  }, []);

  // The cockpit as it stood at atMs, rebuilt from what was stored.
  const state = beats.map((beat) => ({
    ...beat,
    // A beat is filled once the learner got there. reachedAtMs is when it
    // became current; coverage shows from the moment it was covered, which is
    // the next beat's reach time or the end of the answer.
    coveredNow: beat.liveCovered && reachedByNext(beats, beat) <= atMs,
    currentNow: false,
  }));
  const currentIndex = state.findIndex((beat) => !beat.coveredNow);
  const current = currentIndex === -1 ? state.length - 1 : currentIndex;
  const currentBeat = state[current];

  const spentMs = currentBeat
    ? Math.max(0, atMs - (currentBeat.reachedAtMs ?? 0))
    : 0;
  const pace: PaceState = currentBeat ? paceAt(spentMs, currentBeat.seconds) : "never_reached";

  const nudge = nudges.find((n) => atMs >= n.atMs && atMs < n.atMs + NUDGE_LIFETIME_MS) ?? null;

  return (
    <section className="border border-border bg-surface p-4" aria-label="Instrument replay">
      <div className="flex items-baseline justify-between">
        <h2 className="font-medium">Replay with instruments</h2>
        <span className="tnum font-mono text-text-dim">
          {clock(atMs)} / {clock(durationMs)}
        </span>
      </div>

      {!showsNudges && (
        <p className="mt-2 text-text-dim">
          You answered without these. Here is the same answer with them turned on, including
          every nudge that would have fired.
        </p>
      )}

      {audioUrl ? (
        <audio
          ref={audio}
          src={audioUrl}
          preload="metadata"
          onEnded={stop}
          className="mt-3 w-full"
          controls
        />
      ) : (
        <p className="mt-2 text-text-faint">
          There is no recording for this session, so the replay runs on its own clock. The
          instruments are the ones your answer produced.
        </p>
      )}

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={play}
          className="rounded border border-accent px-3 py-1.5 text-accent hover:bg-surface-2"
        >
          {playing ? "Pause" : "Play the instruments"}
        </button>
        <input
          type="range"
          min={0}
          max={Math.max(1, Math.round(durationMs))}
          value={Math.round(atMs)}
          onChange={(event) => scrub(Number(event.target.value))}
          aria-label="Position in the answer"
          className="flex-1"
        />
      </div>

      <div className="mt-6 space-y-6">
        <BeatTrack
          beats={state.map((beat) => ({
            key: beat.key,
            label: beat.label,
            seconds: beat.seconds,
            anchors: beat.anchors,
            covered: beat.coveredNow,
            hitAnchors: [],
            reachedAtMs: beat.reachedAtMs,
            coveredAtMs: null,
            spentMs: 0,
            pace: "on_budget",
            skipped: false,
          }))}
          currentIndex={current}
        />
        <PaceBand state={pace} spentMs={spentMs} />
        <Territory
          row={(currentBeat?.anchors ?? []).map((term) => ({ term, hit: false }))}
        />
        <NudgeSlot line={nudge?.line ?? null} />
      </div>

      {nudges.length > 0 && (
        <ol className="mt-6 space-y-1 border-t border-border pt-4 text-text-dim">
          {nudges.map((line) => (
            <li key={`${line.atMs}-${line.kind}`}>
              <button
                type="button"
                onClick={() => scrub(line.atMs)}
                className="text-left hover:text-text"
              >
                <span className="tnum font-mono text-text-faint">{clock(line.atMs)}</span>{" "}
                {line.line}
                {!line.wasShown && <span className="text-text-faint"> (not shown at the time)</span>}
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** When a beat stopped being the current one, which is when the next beat was
 *  reached. The last beat is covered from the moment it is reached. */
function reachedByNext(beats: ReplayBeat[], beat: DebriefBeat): number {
  const index = beats.findIndex((candidate) => candidate.key === beat.key);
  const next = beats[index + 1];
  return next?.reachedAtMs ?? beat.reachedAtMs ?? 0;
}

/** The same thresholds as the live pace band, applied to replay time. */
function paceAt(spentMs: number, seconds: number): PaceState {
  const budget = seconds * 1000;
  if (spentMs >= budget * 1.75) return "overrun";
  if (spentMs >= budget * 1.3) return "stretching";
  return "on_budget";
}
