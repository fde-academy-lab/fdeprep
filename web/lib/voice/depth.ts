/**
 * Where an answer stayed shallow, beat by beat. docs/07 section 6, as amended
 * 30 September 2026.
 *
 * Measured before it was built. The markers a coach reaches for first, some
 * evidence, a number and a named trade-off, do not separate a strong answer
 * from a weak one in the 36 authored exemplars: evidence shows in 4 of 12
 * strong answers and 2 of 12 weak ones, a number in 12 and 9, a trade-off
 * phrase in 7 and 6. docs/10 section 4 found the same for trade-off phrases
 * and keeps that rule off voice. A debrief that marked them would tell most
 * strong answers they were shallow.
 *
 * What does separate them is the territory each beat's anchors name. Matched
 * the way the cockpit matches, every strong exemplar names all of its
 * question's anchors, an adequate one names 13 percent of them on average and
 * a weak one 4. The anchors were written alongside the strong exemplars, so
 * that gap is partly by construction. That is why the debrief shows the words
 * and the sentence a strong answer used rather than calling the answer
 * shallow: it is what the learner could have volunteered, and it is true.
 *
 * Matching is the cue engine's own, so the debrief and the cockpit agree on
 * what counts as having said a thing. It runs over the whole answer rather
 * than each beat's stretch of it, because a typed answer has no timings and a
 * spoken one often lands a beat's words while another beat is current.
 */
import { anchorsHitIn } from "./cues.ts";

export type BeatDepth = {
  key: string;
  /** This beat's anchors that the answer said, in authored order. */
  named: string[];
  /** This beat's anchors that the answer never said. */
  missing: string[];
  /** The strong exemplar's sentence that names most of this beat's anchors,
   *  or null when it names none of them or the question has no exemplar. */
  strongLine: string | null;
};

/** Sentences, split after a full stop, a question mark or an exclamation. */
export function sentences(text: string): string[] {
  return text.replace(/\s+/g, " ").trim()
    .split(/(?<=[.!?])\s+(?=["'A-Z0-9])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

export function strongLineFor(anchors: string[], strong: string | null): string | null {
  if (!strong) return null;
  let best: string | null = null;
  let most = 0;
  for (const sentence of sentences(strong)) {
    const hits = anchorsHitIn(sentence, anchors).length;
    if (hits > most) {
      best = sentence;
      most = hits;
    }
  }
  return best;
}

export function depthByBeat(
  beats: Array<{ key: string; anchors: string[] }>,
  transcript: string,
  strong: string | null,
): BeatDepth[] {
  return beats.map((beat) => {
    const named = anchorsHitIn(transcript, beat.anchors);
    return {
      key: beat.key,
      named,
      missing: beat.anchors.filter((anchor) => !named.includes(anchor)),
      strongLine: strongLineFor(beat.anchors, strong),
    };
  });
}
