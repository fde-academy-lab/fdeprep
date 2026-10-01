/**
 * The development socket keeps serving when one session's transcriber fails.
 *
 * Found on 1 October 2026 by starting the socket without VOICE_STT=scripted on
 * a machine with no AWS credentials. Amazon Transcribe refused to open, the
 * rejection escaped the connection handler, and Node ended the process, so
 * every Start after the first failed to connect until somebody restarted it.
 * A second race lived in the same handler: audio that arrived while the
 * transcriber was still opening was pushed before open, which throws.
 */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { once } from "node:events";
import { test } from "node:test";
import WebSocket from "ws";
import { encodeFrame, type ServerMessage } from "../../web/lib/voice/protocol.ts";
import { mintVoiceToken } from "../../web/lib/voice/token.ts";
import { FRAME_BYTES } from "../src/config.ts";
import { startDevServer } from "../src/dev-server.ts";
import { BaseAdapter } from "../src/stt/adapter.ts";

const SECRET = "a-development-secret";
process.env.VOICE_TOKEN_SECRET = SECRET;
process.env.VOICE_STT = "scripted";

const token = mintVoiceToken({ sid: "41", eid: 7, qid: 3, mode: "guided" }, SECRET);

/** A transcriber that cannot open, the way Transcribe cannot without credentials. */
class Refuses extends BaseAdapter {
  async open(): Promise<void> {
    throw new Error("Could not load credentials from any providers");
  }
  push(): void {
    throw new Error("push before open.");
  }
  async close(): Promise<void> {}
}

/** A transcriber that takes a moment to open and records what reaches it. */
class Slow extends BaseAdapter {
  opened = false;
  frames: number[] = [];
  async open(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 150));
    this.opened = true;
  }
  push(frame: Int16Array): void {
    if (!this.opened) throw new Error("push before open.");
    this.frames.push(frame[0]!);
  }
  async close(): Promise<void> {}
}

async function listening(server: ReturnType<typeof startDevServer>): Promise<number> {
  if (!server.listening) await once(server, "listening");
  return (server.address() as AddressInfo).port;
}

/** Connect, send what is given as soon as the socket opens, and collect every
 *  message until the server closes it or the wait runs out. */
function converse(port: number, send: string[] = [], waitMs = 1_000) {
  return new Promise<{ messages: ServerMessage[]; code: number | null }>((resolve) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/?token=${encodeURIComponent(token)}`);
    const messages: ServerMessage[] = [];
    const timer = setTimeout(() => {
      socket.close();
      resolve({ messages, code: null });
    }, waitMs);
    socket.on("open", () => send.forEach((raw) => socket.send(raw)));
    socket.on("message", (data) => messages.push(JSON.parse(data.toString()) as ServerMessage));
    socket.on("close", (code) => {
      clearTimeout(timer);
      resolve({ messages, code });
    });
  });
}

const frame = (seq: number) => JSON.stringify({
  t: "audio", seq, pcm: encodeFrame(new Int16Array(FRAME_BYTES / 2).fill(seq + 1)),
});

test("a transcriber that will not open ends that session, says why, and the socket keeps serving", async () => {
  const server = startDevServer(0, () => new Refuses());
  try {
    const port = await listening(server);
    const first = await converse(port, [frame(0)]);
    const error = first.messages.find((message) => message.t === "error");
    assert.ok(error && error.t === "error", "the browser is told");
    assert.equal(error.code, "stt_failed");
    assert.match(error.message, /Could not load credentials/);
    assert.equal(first.code, 1011);

    // Still listening, so the next Start is not a connection failure.
    const second = await converse(port);
    assert.ok(second.messages.some((message) => message.t === "error"));
  } finally {
    server.close();
  }
});

test("audio that arrives while the transcriber opens reaches it, in order, once it is open", async () => {
  const adapters: Slow[] = [];
  const server = startDevServer(0, () => {
    const adapter = new Slow();
    adapters.push(adapter);
    return adapter;
  });
  try {
    const port = await listening(server);
    const { messages } = await converse(port, [frame(0), frame(1), frame(2)], 600);
    assert.ok(messages.some((message) => message.t === "ready"));
    assert.ok(!messages.some((message) => message.t === "error"), JSON.stringify(messages));
    assert.deepEqual(adapters[0]!.frames, [1, 2, 3]);
  } finally {
    server.close();
  }
});
