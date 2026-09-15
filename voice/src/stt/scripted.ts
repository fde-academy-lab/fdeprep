/**
 * A deterministic adapter with no provider behind it.
 *
 * Two jobs. In tests it makes partial and final timing something a test can
 * assert instead of something a network decides. On a developer machine it
 * makes the capture pipeline provable without an AWS credential: it reads the
 * energy of each frame, so words appear while you speak and a final lands
 * when you stop. A socket that is open but delivering silence looks different
 * from one that is working, which is the whole point of a transport test.
 *
 * The words are placeholders and carry no meaning. Real questions, rubrics
 * and exemplars are authored content and land in Phase 8.
 */
import { BaseAdapter } from "./adapter.ts";
import { FRAME_MS } from "../config.ts";

const PLACEHOLDER_WORDS = [
  "alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel",
  "india", "juliet", "kilo", "lima", "mike", "november", "oscar", "papa",
];

/** Root mean square of a 16-bit frame, as a fraction of full scale. Speech at
 *  a normal level sits well above this; room noise with noiseSuppression on
 *  sits well below. */
const VOICED_RMS = 0.01;

/** Voiced audio needed before another word is added to the partial. */
const MS_PER_WORD = 400;

/** Silence that ends an utterance and promotes the partial to a final. */
const SILENCE_TO_FINAL_MS = 700;

export class ScriptedAdapter extends BaseAdapter {
  private elapsedMs = 0;
  private voicedMs = 0;
  private silentMs = 0;
  private words: string[] = [];
  private utteranceStartMs = 0;
  private opened = false;

  async open(_sessionId: string, _opts: { sampleRate: number; language: string }): Promise<void> {
    this.opened = true;
  }

  push(frame: Int16Array): void {
    if (!this.opened) throw new Error("push before open.");
    this.elapsedMs += FRAME_MS;

    let sum = 0;
    for (const sample of frame) sum += sample * sample;
    const rms = Math.sqrt(sum / Math.max(1, frame.length)) / 32768;

    if (rms >= VOICED_RMS) {
      if (this.words.length === 0) this.utteranceStartMs = this.elapsedMs - FRAME_MS;
      this.silentMs = 0;
      this.voicedMs += FRAME_MS;
      const wanted = Math.floor(this.voicedMs / MS_PER_WORD) + 1;
      while (this.words.length < wanted) {
        this.words.push(PLACEHOLDER_WORDS[this.words.length % PLACEHOLDER_WORDS.length]!);
        this.partial(this.words.join(" "), this.utteranceStartMs);
      }
      return;
    }

    this.silentMs += FRAME_MS;
    if (this.silentMs >= SILENCE_TO_FINAL_MS) this.flush();
  }

  private flush(): void {
    if (this.words.length === 0) return;
    this.final(this.words.join(" "), this.utteranceStartMs, this.elapsedMs - this.silentMs);
    this.words = [];
    this.voicedMs = 0;
    this.silentMs = 0;
  }

  async close(): Promise<void> {
    this.flush();
    this.opened = false;
  }
}
