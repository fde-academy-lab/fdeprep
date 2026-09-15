"use client";

/**
 * The five live instruments, and nothing else. docs/07 section 3.
 *
 * Counted here so the count is checkable: BeatTrack, PaceBand, Territory,
 * MicLevel, NudgeSlot. Adding a sixth means editing this file and the test
 * that asserts what the cockpit renders, which is the point of keeping them
 * in one place.
 *
 * The visual rules from section 3, each visible in the code below:
 *
 *   one primary instrument       the beat track is the only thing with weight
 *   nothing moves except the     no transition anywhere but the mic meter,
 *   pace band and the mic level  and the pace band's colour switches outright
 *   colour carries state only    pass, warn and fail appear here and nowhere
 *                                else on the screen
 *   no number over three         every figure is the clock, which is m:ss
 *   characters                   and read as a time rather than a number
 *   one type size                only the question and the clock differ
 *
 * Every instrument is also readable without sight: the beat track is a list
 * with per-beat state in its label, the pace band is a word before it is a
 * colour, and the nudge slot is a live region.
 */
import { PACE_WORD, type BeatProgress, type PaceState } from "@/lib/voice/cues";

/** docs/07 section 3: colour carries state only, one meaning each. */
const PACE_TONE: Record<PaceState, string> = {
  on_budget: "border-pass text-pass",
  stretching: "border-warn text-warn",
  overrun: "border-fail text-fail",
  never_reached: "border-border text-text-faint",
};

export function clock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * The primary instrument. Passed beats fill, the current beat is outlined in
 * the accent, future beats stay outlines.
 *
 * "the current beat pulses slowly" in section 3 is the one place the spec
 * asks for motion that section's own rule then forbids ("nothing moves except
 * the pace band and the mic level"). The rule wins: the current beat is
 * marked by the accent border and by NOW under it, which is legible at a
 * glance and does not compete with the two instruments that do move.
 */
export function BeatTrack({
  beats,
  currentIndex,
}: {
  beats: readonly BeatProgress[];
  currentIndex: number;
}) {
  return (
    <ol className="flex gap-1" aria-label="Beat track">
      {beats.map((beat, index) => {
        const current = index === currentIndex;
        const state = beat.covered ? "covered" : current ? "current" : "not reached";
        return (
          <li key={beat.key} className="flex-1">
            <div
              aria-hidden="true"
              className={`h-3 border ${
                beat.covered
                  ? "border-accent bg-accent"
                  : current
                    ? "border-accent"
                    : "border-border"
              }`}
            />
            <div className="mt-1 flex justify-between font-mono text-text-faint">
              <span aria-hidden="true">{beat.key}</span>
              <span aria-hidden="true" className={current ? "text-accent" : ""}>
                {beat.covered ? "ok" : current ? "NOW" : "--"}
              </span>
            </div>
            <span className="sr-only">
              {beat.key}, {beat.label}, {state}
              {beat.skipped ? ", jumped" : ""}.
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * One word and a clock, nothing else.
 *
 * The colour changes with no transition, because the change is the signal: a
 * hundred milliseconds of green fading to amber is a hundred milliseconds of
 * a learner not knowing which one it is.
 */
export function PaceBand({ state, spentMs }: { state: PaceState; spentMs: number }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`Pace ${PACE_WORD[state]}, ${clock(spentMs)} on this beat`}
      style={{ transition: "none" }}
      className={`mx-auto flex w-56 items-baseline justify-between border px-3 py-2
                  font-mono ${PACE_TONE[state]}`}
    >
      <span>{PACE_WORD[state]}</span>
      <span className="tnum">{clock(spentMs)}</span>
    </div>
  );
}

/** The current beat's anchor terms, dimmed, brightening as they are said.
 *  Landmarks, not answers. */
export function Territory({ row }: { row: { term: string; hit: boolean }[] }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span className="text-text-faint">territory</span>
      {row.map(({ term, hit }, index) => (
        <span key={term} className={hit ? "text-text" : "text-text-faint"}>
          {index > 0 && <span className="mr-2 text-text-faint">·</span>}
          {term}
          {hit && <span className="sr-only"> said</span>}
        </span>
      ))}
      {row.length === 0 && <span className="text-text-faint">every beat covered</span>}
    </p>
  );
}

/**
 * One horizontal meter whose only job is to prove the microphone is live.
 *
 * It moves, which section 3 permits, and it carries no state colour: a level
 * meter in green would spend one of the three state colours on something that
 * is not a state.
 */
export function MicLevel({ rms, live }: { rms: number; live: boolean }) {
  return (
    <div
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.min(100, Math.round(rms * 400))}
      aria-label={live ? "Microphone level" : "Microphone not running"}
      className="h-2 w-full bg-surface-2"
    >
      <div
        className="h-2 bg-text-dim"
        style={{ width: `${Math.min(100, Math.round(rms * 400))}%`, transition: "width 80ms" }}
      />
    </div>
  );
}

/**
 * One fixed line. One nudge at a time, never stacked.
 *
 * The slot is always in the layout whether or not it holds a line, so the
 * cockpit does not reflow when one arrives. It is its own live region, so a
 * screen reader hears the nudge without hearing the whole cockpit again.
 */
export function NudgeSlot({ line }: { line: string | null }) {
  return (
    <p role="status" aria-live="assertive" aria-atomic="true" className="h-6 font-mono">
      {line ? (
        <>
          <span aria-hidden="true" className="text-text-faint">&gt; </span>
          <span className="text-accent">{line}</span>
        </>
      ) : (
        <span className="sr-only">No nudge.</span>
      )}
    </p>
  );
}

/**
 * The non-visual half of the beat track.
 *
 * A sighted learner sees a segment fill. Everyone else needs telling, and
 * telling once: this is polite rather than assertive so it waits for a gap
 * instead of talking over the nudge slot, which is the more urgent of the
 * two. It announces beat labels and nudge lines only. It never announces a
 * word the learner said.
 */
export function Announcer({ message }: { message: string | null }) {
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {message ?? ""}
    </div>
  );
}
