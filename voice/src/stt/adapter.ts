/**
 * The speech-to-text seam.
 *
 * docs/07 section 7 specifies this interface and the reason for it: ship with
 * Amazon Transcribe, keep a second adapter ready, and measure time to first
 * partial on real learner audio in Phase 8 before deciding to switch. Nothing
 * above this line knows which provider is behind it.
 */

/** Reproduced from docs/07 section 7 without change. */
export interface SttAdapter {
  open(sessionId: string, opts: { sampleRate: number; language: string }): Promise<void>;
  push(frame: Int16Array): void;
  onPartial(cb: (text: string, startMs: number) => void): void;
  onFinal(cb: (text: string, startMs: number, endMs: number) => void): void;
  close(): Promise<void>;
}

/**
 * The specified interface has no error channel, and a stream that dies at
 * 0:40 of a five minute answer has to reach the session before close() is
 * called, or the learner keeps talking into nothing.
 *
 * So the five specified methods stay exactly as written above and this adds a
 * sixth alongside them rather than editing the five. Everything in this
 * package implements SttErrors; anything typed as a bare SttAdapter still
 * works, which is what keeps the second adapter cheap to write.
 */
export interface SttErrors {
  onError(cb: (error: Error) => void): void;
}

export type VoiceAdapter = SttAdapter & SttErrors;

/** A tiny base that holds the callbacks, so each adapter writes only the
 *  provider-specific half. */
export abstract class BaseAdapter implements VoiceAdapter {
  protected partial: (text: string, startMs: number) => void = () => {};
  protected final: (text: string, startMs: number, endMs: number) => void = () => {};
  protected failed: (error: Error) => void = () => {};

  onPartial(cb: (text: string, startMs: number) => void): void {
    this.partial = cb;
  }

  onFinal(cb: (text: string, startMs: number, endMs: number) => void): void {
    this.final = cb;
  }

  onError(cb: (error: Error) => void): void {
    this.failed = cb;
  }

  abstract open(sessionId: string, opts: { sampleRate: number; language: string }): Promise<void>;
  abstract push(frame: Int16Array): void;
  abstract close(): Promise<void>;
}
