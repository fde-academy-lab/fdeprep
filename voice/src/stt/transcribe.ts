/**
 * Amazon Transcribe streaming, behind the docs/07 section 7 adapter.
 *
 * Verified 2026-09-15 against the Amazon Transcribe Developer Guide
 * ("Transcribing streaming audio", "Setting up a streaming transcription"),
 * the StartStreamTranscription API reference, and the TypeScript types
 * shipped in @aws-sdk/client-transcribe-streaming 3.1132.0:
 *
 *   MediaEncoding             "pcm" | "ogg-opus" | "flac"; pcm means signed
 *                             16-bit little-endian, which excludes WAV
 *   MediaSampleRateHertz      8,000 to 48,000; the guide recommends 16,000
 *   chunk size                50ms to 200ms, uniform, even byte count for
 *                             single-channel PCM
 *   Result.IsPartial          true while the segment is incomplete
 *   Result.StartTime/EndTime  seconds as a double, millisecond precision
 *   SessionResumeWindow       minutes, 1 to 300 (the SDK's own doc comment
 *                             and the API reference agree on minutes)
 *
 * The three transports are the AWS SDKs, HTTP/2 and WebSockets, and the guide
 * says plainly that SDKs are "the simplest and most reliable method". This
 * uses the SDK, which means no hand-rolled SigV4 event-stream signing.
 */
import {
  StartStreamTranscriptionCommand,
  TranscribeStreamingClient,
  type AudioStream,
  type LanguageCode,
  type PartialResultsStability,
} from "@aws-sdk/client-transcribe-streaming";
import { BaseAdapter } from "./adapter.ts";
import type { VoiceConfig } from "../config.ts";

/** Frames waiting to reach the service. At 100ms a frame, this is 30 seconds
 *  of audio; past it the network is not the problem any more and dropping the
 *  oldest frame beats growing until the Lambda dies. */
const QUEUE_LIMIT = 300;

/** An async queue a synchronous push() can write into and the SDK's async
 *  iterable can read out of. */
class FrameQueue {
  private readonly frames: Uint8Array[] = [];
  private waiting: ((value: IteratorResult<Uint8Array>) => void) | null = null;
  private done = false;
  dropped = 0;

  push(frame: Uint8Array): void {
    if (this.done) return;
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve({ value: frame, done: false });
      return;
    }
    if (this.frames.length >= QUEUE_LIMIT) {
      this.frames.shift();
      this.dropped += 1;
    }
    this.frames.push(frame);
  }

  end(): void {
    this.done = true;
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve({ value: undefined, done: true });
    }
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {
    for (;;) {
      const next = this.frames.shift();
      if (next !== undefined) {
        yield next;
        continue;
      }
      if (this.done) return;
      const result = await new Promise<IteratorResult<Uint8Array>>((resolve) => {
        this.waiting = resolve;
      });
      if (result.done) return;
      yield result.value;
    }
  }
}

export class TranscribeAdapter extends BaseAdapter {
  private readonly client: TranscribeStreamingClient;
  private readonly config: VoiceConfig;
  private readonly queue = new FrameQueue();
  private reading: Promise<void> | null = null;
  private opened = false;

  /** The client is injectable so a test can assert the request this builds
   *  without a credential and without a network call. Nothing in production
   *  passes it. */
  constructor(config: VoiceConfig, client?: TranscribeStreamingClient) {
    super();
    this.config = config;
    this.client = client ?? new TranscribeStreamingClient({ region: config.region });
  }

  /**
   * `sessionId` becomes Transcribe's own SessionId, which the API reference
   * fixes at 36 characters in UUID form. Passing it is what lets a later
   * invocation resume the same transcription inside the resume window instead
   * of starting cold, so the caller owning a stable UUID per answer is not
   * incidental and a wrong shape fails here rather than at the service.
   */
  async open(sessionId: string, opts: { sampleRate: number; language: string }): Promise<void> {
    if (!/^[a-fA-F0-9]{8}(-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$/.test(sessionId)) {
      throw new Error(
        `Transcribe requires a UUID session id, got "${sessionId}". ` +
          "Generate one per answer and reuse it for every segment of that answer.",
      );
    }

    const audio: AsyncIterable<AudioStream> = (async function* (queue: FrameQueue) {
      for await (const chunk of queue) yield { AudioEvent: { AudioChunk: chunk } };
    })(this.queue);

    const response = await this.client.send(
      new StartStreamTranscriptionCommand({
        LanguageCode: opts.language as LanguageCode,
        MediaEncoding: "pcm",
        MediaSampleRateHertz: opts.sampleRate,
        SessionId: sessionId,
        SessionResumeWindow: this.config.resumeWindowMinutes,
        EnablePartialResultsStabilization: this.config.stabilizePartials,
        ...(this.config.stabilizePartials
          ? { PartialResultsStability: "medium" as PartialResultsStability }
          : {}),
        AudioStream: audio,
      }),
    );
    this.opened = true;
    this.reading = this.read(response.TranscriptResultStream);
  }

  private async read(stream: AsyncIterable<unknown> | undefined): Promise<void> {
    if (!stream) {
      this.failed(new Error("Transcribe accepted the stream but returned no result stream."));
      return;
    }
    try {
      for await (const event of stream) {
        const results = (event as { TranscriptEvent?: { Transcript?: { Results?: unknown[] } } })
          .TranscriptEvent?.Transcript?.Results;
        if (!results) {
          // Every other member of the union is an exception member, and the
          // SDK does not throw for them, so an unhandled one would look like
          // a stream that simply stopped producing text.
          const name = Object.keys(event as object).find((key) => key.endsWith("Exception"));
          if (name) this.failed(new Error(`Amazon Transcribe returned ${name}.`));
          continue;
        }
        for (const result of results as TranscribeResult[]) this.emit(result);
      }
    } catch (error) {
      this.failed(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /** StartTime and EndTime arrive in seconds with millisecond precision; the
   *  adapter contract is milliseconds. */
  private emit(result: TranscribeResult): void {
    const text = result.Alternatives?.[0]?.Transcript;
    if (!text) return;
    const startMs = Math.round((result.StartTime ?? 0) * 1000);
    if (result.IsPartial) this.partial(text, startMs);
    else this.final(text, startMs, Math.round((result.EndTime ?? 0) * 1000));
  }

  push(frame: Int16Array): void {
    if (!this.opened) throw new Error("push before open.");
    this.queue.push(new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength));
  }

  async close(): Promise<void> {
    this.queue.end();
    if (this.reading) await this.reading;
    this.client.destroy();
    if (this.queue.dropped > 0) {
      this.failed(
        new Error(
          `${this.queue.dropped} audio frames were dropped before reaching Amazon Transcribe.`,
        ),
      );
    }
  }
}

type TranscribeResult = {
  IsPartial?: boolean;
  StartTime?: number;
  EndTime?: number;
  Alternatives?: { Transcript?: string }[];
};
