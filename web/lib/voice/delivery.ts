/**
 * Delivery metrics. Reported in the debrief and nowhere else.
 *
 * Its own module on purpose. docs/07 section 6's fairness rule is the one
 * thing in the Voice Screen that a well-meaning edit could break without
 * anyone noticing, so the numbers live apart from score.ts, are returned as
 * their own type, and are imported by exactly two files: the debrief that
 * shows them and the test that proves nothing else does.
 *
 * Why the rule exists, in the spec's own words: most learners here speak
 * English as a second or third language, and scoring fluency, accent, pace
 * against a native-speaker band or filler rate would measure the wrong thing
 * and would tell a strong engineer they are weak.
 */

export type Segment = { text: string; startMs: number; endMs: number };

export type Delivery = {
  wordsPerMinute: number;
  fillerCount: number;
  longestPauseMs: number;
  /** Time actually spent speaking, which is what words per minute divides by.
   *  Dividing by the wall clock would make a thoughtful pause look like slow
   *  speech. */
  speakingMs: number;
};

/**
 * The fillers counted.
 *
 * English only, and deliberately short. A longer list catches more and misses
 * worse: "like" and "so" are ordinary words in an engineering sentence, and
 * counting them would hand a learner a number that punishes them for speaking
 * normally. These five are the ones that are fillers and nothing else.
 */
export const FILLERS = ["um", "uh", "erm", "hmm", "mmm"];

const WORD = /[a-z0-9']+/g;

export function deliveryFor(segments: Segment[]): Delivery {
  if (segments.length === 0) {
    return { wordsPerMinute: 0, fillerCount: 0, longestPauseMs: 0, speakingMs: 0 };
  }

  const ordered = [...segments].sort((a, b) => a.startMs - b.startMs);

  let words = 0;
  let fillerCount = 0;
  let speakingMs = 0;
  for (const segment of ordered) {
    speakingMs += Math.max(0, segment.endMs - segment.startMs);
    for (const word of segment.text.toLowerCase().match(WORD) ?? []) {
      words += 1;
      if (FILLERS.includes(word)) fillerCount += 1;
    }
  }

  // The gap between one segment ending and the next beginning. Transcribe
  // emits a final segment when speech stops, so the gaps are the silences.
  let longestPauseMs = 0;
  for (const [index, segment] of ordered.entries()) {
    if (index === 0) continue;
    longestPauseMs = Math.max(longestPauseMs, segment.startMs - ordered[index - 1]!.endMs);
  }

  const minutes = speakingMs / 60_000;
  return {
    wordsPerMinute: minutes > 0 ? Math.round(words / minutes) : 0,
    fillerCount,
    longestPauseMs: Math.max(0, Math.round(longestPauseMs)),
    speakingMs: Math.round(speakingMs),
  };
}

/** The line the debrief prints. One place, so the wording and the "not
 *  scored" label travel together. */
export function deliveryLine(delivery: Delivery): string {
  const seconds = Math.round(delivery.longestPauseMs / 1000);
  return (
    `${delivery.wordsPerMinute} words per minute · ` +
    `${delivery.fillerCount} filler${delivery.fillerCount === 1 ? "" : "s"} · ` +
    `longest pause ${seconds}s`
  );
}
