/**
 * The half that holds the Amazon Transcribe stream.
 *
 * Driven by the frame queue, one batch at a time. Every batch of one answer
 * presents the same Transcribe SessionId, derived from the connection id, so
 * the service resumes that transcription inside the configured resume window
 * rather than starting cold and cutting the word at each boundary.
 *
 * The honest limit of this shape: latency is the batch window plus the time
 * to open the stream, not the sub-second a purpose-built socket would give.
 * docs/07 section 7 already says to measure time to first partial on real
 * learner audio in Phase 8 before choosing an adapter, and this is the other
 * number that measurement has to cover.
 */
import { loadConfig } from "../config.ts";
import { sttSessionIdFor } from "../ids.ts";
import { adapterFor } from "../stt/index.ts";
import { VoiceSession } from "../session.ts";
import type { FrameMessage } from "./socket.ts";
import type { SqsEvent } from "./events.ts";
import { postTo } from "./post.ts";

type Batch = { endpoint: string; frames: FrameMessage[] };

/** SQS delivers a batch that may mix connections even with FIFO groups, so
 *  group by connection before opening anything. */
function group(event: SqsEvent): Map<string, Batch> {
  const batches = new Map<string, Batch>();
  for (const record of event.Records) {
    let message: FrameMessage;
    try {
      message = JSON.parse(record.body) as FrameMessage;
    } catch {
      console.warn(`voice runner: unparseable queue message ${record.messageId}`);
      continue;
    }
    const batch = batches.get(message.connectionId) ?? {
      endpoint: message.endpoint,
      frames: [],
    };
    batch.frames.push(message);
    batches.set(message.connectionId, batch);
  }
  return batches;
}

async function runBatch(connectionId: string, batch: Batch): Promise<void> {
  const config = loadConfig();
  const adapter = adapterFor(config);
  let live = true;

  const session = new VoiceSession({
    sessionId: connectionId,
    sttSessionId: sttSessionIdFor(connectionId),
    adapter,
    config,
    ownsWholeAnswer: false,
    emit: async (message) => {
      if (!live) return;
      live = await postTo(batch.endpoint, connectionId, message);
    },
  });

  await session.start();
  for (const frame of batch.frames) {
    if (!live) break;
    if (frame.kind === "end") {
      await session.close(frame.reason);
      return;
    }
    await session.handle(JSON.stringify({ t: "audio", seq: frame.seq, pcm: frame.pcm }));
  }

  // A batch that is not the end of the answer still closes its adapter: the
  // stream belongs to this invocation and the next batch opens a new one
  // against the same Transcribe session. The "closed" message would be a lie
  // here, so the session is drained without emitting one.
  await adapter.close();
}

export async function handler(event: SqsEvent): Promise<void> {
  for (const [connectionId, batch] of group(event)) {
    try {
      await runBatch(connectionId, batch);
    } catch (error) {
      console.error(`voice runner failed for ${connectionId}:`, error);
      await postTo(batch.endpoint, connectionId, {
        t: "error",
        code: "stt_failed",
        message:
          "Transcription stopped. Your audio is still being recorded and the answer still " +
          "counts. The live cues will not update.",
      });
    }
  }
}
