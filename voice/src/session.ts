/**
 * One answer, from the first frame to the close, with no transport in it.
 *
 * The same object runs behind the local development socket and behind the
 * Lambda, so what the test page proves about framing, the idle timeout and
 * the close reasons is what runs in AWS. The seam the two paths do not share
 * is how long one adapter lives, and that is named where it happens.
 */
import {
  decodeFrame,
  parseClientMessage,
  FRAME_LIMIT_BYTES,
  type CloseReason,
  type ServerMessage,
} from "../../web/lib/voice/protocol.ts";
import { FRAME_BYTES, IDLE_TIMEOUT_MS, SESSION_CEILING_MS, type VoiceConfig } from "./config.ts";
import type { VoiceAdapter } from "./stt/adapter.ts";

export type Emit = (message: ServerMessage) => void | Promise<void>;

export type SessionOptions = {
  /** voice_session.id, for the learner-facing record. */
  sessionId: string;
  /** The UUID Amazon Transcribe knows this answer by. Stable for the whole
   *  answer, so a segment opened later resumes rather than restarts. */
  sttSessionId: string;
  adapter: VoiceAdapter;
  config: VoiceConfig;
  emit: Emit;
  now?: () => number;
  /**
   * True when this object saw the whole answer, which is the case behind the
   * development socket and not the case in the Lambda path, where one object
   * handles one batch of frames. A batch that reported its own few finals as
   * "the transcript" would be a lie the size of the answer, so the closing
   * message carries nothing when this is false and Phase 7c assembles the
   * answer from the stored finals instead.
   */
  ownsWholeAnswer?: boolean;
};

export class VoiceSession {
  private readonly opts: SessionOptions;
  private readonly now: () => number;
  private readonly startedAt: number;
  private lastFrameAt: number;
  private finals: string[] = [];
  private frames = 0;
  private closed: CloseReason | null = null;
  private failure: Error | null = null;

  constructor(opts: SessionOptions) {
    this.opts = opts;
    this.now = opts.now ?? Date.now;
    this.startedAt = this.now();
    this.lastFrameAt = this.startedAt;
  }

  get frameCount(): number {
    return this.frames;
  }

  get transcript(): string {
    return this.finals.join(" ");
  }

  get closeReason(): CloseReason | null {
    return this.closed;
  }

  async start(): Promise<void> {
    const { adapter, config, emit, sessionId, sttSessionId } = this.opts;

    // Partials are the live cue feed. docs/07 section 3 forbids rendering
    // them, and the standing rule in CLAUDE.md says the same; the cockpit
    // obeys that, and the transport still has to carry them or the cues have
    // nothing to match against.
    adapter.onPartial((text, startMs) => void emit({ t: "partial", text, startMs }));
    adapter.onFinal((text, startMs, endMs) => {
      this.finals.push(text);
      void emit({ t: "final", text, startMs, endMs });
    });
    adapter.onError((error) => {
      this.failure = error;
      void emit({ t: "error", code: "stt_failed", message: error.message });
    });

    await adapter.open(sttSessionId, {
      sampleRate: config.sampleRate,
      language: config.language,
    });
    await emit({ t: "ready", sessionId, sampleRate: config.sampleRate });
  }

  /** Act on one raw socket message. Returns false when the session is over,
   *  so the transport knows to stop reading. */
  async handle(raw: string): Promise<boolean> {
    if (this.closed) return false;

    if (raw.length > FRAME_LIMIT_BYTES) {
      await this.opts.emit({
        t: "error",
        code: "frame_too_large",
        message:
          `A ${raw.length} byte message exceeds the ${FRAME_LIMIT_BYTES} byte WebSocket frame ` +
          "limit. Send one 100ms frame per message. Nothing was recorded from it.",
      });
      return true;
    }

    const message = parseClientMessage(raw);
    if (!message) {
      await this.opts.emit({
        t: "error",
        code: "bad_message",
        message: "That message is not audio or stop. Nothing was recorded from it.",
      });
      return true;
    }

    if (message.t === "stop") {
      await this.close("stopped");
      return false;
    }

    // Amazon Transcribe's own guidance is 50ms to 200ms of audio per chunk,
    // uniform. The client chooses when to send, not how much a chunk may
    // hold, so a message carrying seconds of audio is refused rather than
    // forwarded: it would arrive as one late block and make every live cue
    // late with it.
    const samples = decodeFrame(message.pcm);
    if (samples && samples.byteLength > FRAME_BYTES * 2) {
      await this.opts.emit({
        t: "error",
        code: "frame_too_large",
        message:
          `That frame carries ${samples.byteLength} bytes of audio, over the ` +
          `${FRAME_BYTES * 2} byte ceiling for one frame. Send 100ms at a time. ` +
          "Nothing was recorded from it.",
      });
      return true;
    }
    if (!samples) {
      await this.opts.emit({
        t: "error",
        code: "bad_message",
        message:
          "That audio frame is not a whole number of 16-bit samples. " +
          "Nothing was recorded from it.",
      });
      return true;
    }

    this.lastFrameAt = this.now();
    this.frames += 1;
    this.opts.adapter.push(samples);
    return true;
  }

  /**
   * The two ceilings, checked on a timer rather than on arrival, because the
   * case that matters is the socket that has gone quiet and so is sending
   * nothing to check on.
   */
  async tick(): Promise<boolean> {
    if (this.closed) return false;
    const at = this.now();
    if (at - this.startedAt >= SESSION_CEILING_MS) {
      await this.close("ceiling");
      return false;
    }
    if (at - this.lastFrameAt >= IDLE_TIMEOUT_MS) {
      await this.close("idle");
      return false;
    }
    return true;
  }

  /**
   * docs/07 section 12, item 9: a session abandoned mid-answer closes its
   * socket and saves the partial transcript. So closing always drains the
   * adapter first and always reports what it heard, whatever the reason.
   */
  async close(reason: CloseReason): Promise<void> {
    if (this.closed) return;
    this.closed = reason;
    try {
      await this.opts.adapter.close();
    } catch (error) {
      this.failure = error instanceof Error ? error : new Error(String(error));
    }
    await this.opts.emit({
      t: "closed",
      reason: this.failure && reason === "stopped" ? "failed" : reason,
      transcript: this.opts.ownsWholeAnswer === false ? "" : this.transcript,
      frames: this.frames,
    });
  }
}
