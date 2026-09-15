/**
 * The session core: what the socket does with what arrives.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeFrame, type ServerMessage } from "../../web/lib/voice/protocol.ts";
import { FRAME_BYTES, IDLE_TIMEOUT_MS, SESSION_CEILING_MS, loadConfig } from "../src/config.ts";
import { VoiceSession } from "../src/session.ts";
import { BaseAdapter } from "../src/stt/adapter.ts";

const CONFIG = loadConfig({ VOICE_STT: "scripted", AWS_REGION: "eu-west-1" });
const STT_ID = "6f1f1a2c-9d3b-5a4e-8c7d-0e1f2a3b4c5d";

/** Records what it is given and emits on demand, so a test decides timing. */
class Spy extends BaseAdapter {
  frames: Int16Array[] = [];
  closed = false;
  async open(): Promise<void> {}
  push(frame: Int16Array): void {
    this.frames.push(frame);
  }
  async close(): Promise<void> {
    this.closed = true;
  }
  say(text: string, startMs: number, endMs?: number): void {
    if (endMs === undefined) this.partial(text, startMs);
    else this.final(text, startMs, endMs);
  }
  fail(message: string): void {
    this.failed(new Error(message));
  }
}

function harness(now: () => number = Date.now) {
  const adapter = new Spy();
  const out: ServerMessage[] = [];
  const session = new VoiceSession({
    sessionId: "41",
    sttSessionId: STT_ID,
    adapter,
    config: CONFIG,
    emit: (message) => void out.push(message),
    now,
  });
  return { adapter, out, session };
}

function audio(seq = 0, fill = 1000): string {
  return JSON.stringify({
    t: "audio",
    seq,
    pcm: encodeFrame(new Int16Array(FRAME_BYTES / 2).fill(fill)),
  });
}

test("a started session announces itself with the sample rate it resolved", async () => {
  const { out, session } = harness();
  await session.start();
  assert.deepEqual(out, [{ t: "ready", sessionId: "41", sampleRate: 16_000 }]);
});

test("frames reach the adapter and partials and finals come back out", async () => {
  const { adapter, out, session } = harness();
  await session.start();
  await session.handle(audio(0));
  adapter.say("step", 100);
  adapter.say("step budget", 100, 900);
  assert.equal(adapter.frames.length, 1);
  assert.equal(adapter.frames[0]!.length, FRAME_BYTES / 2);
  assert.deepEqual(out.slice(1), [
    { t: "partial", text: "step", startMs: 100 },
    { t: "final", text: "step budget", startMs: 100, endMs: 900 },
  ]);
  assert.equal(session.transcript, "step budget");
});

test("a message that is not audio or stop is refused and costs nothing", async () => {
  const { adapter, out, session } = harness();
  await session.start();

  // Each of these is a thing a browser could try: not JSON, audio with no
  // payload, a negative sequence, a message inventing a sample rate the
  // server already resolved, a payload that is not a whole number of 16-bit
  // samples, and a 400ms frame where the ceiling is the 200ms Amazon
  // Transcribe recommends as the longest chunk.
  for (const attempt of [
    "not json at all",
    JSON.stringify({ t: "audio" }),
    JSON.stringify({ t: "audio", seq: -1, pcm: "AAAA" }),
    JSON.stringify({ t: "config", sampleRate: 48_000 }),
    JSON.stringify({ t: "audio", seq: 0, pcm: "AAAAA" }),
    JSON.stringify({ t: "audio", seq: 0, pcm: encodeFrame(new Int16Array(FRAME_BYTES * 2)) }),
  ]) {
    assert.equal(await session.handle(attempt), true, `${attempt} should not end the session`);
  }

  assert.equal(adapter.frames.length, 0, "nothing reached the adapter");
  assert.equal(session.frameCount, 0);
  assert.equal(out.filter((m) => m.t === "error").length, 6);
  for (const message of out.filter((m) => m.t === "error")) {
    assert.match(message.message, /Nothing was recorded from it\./);
  }
});

test("an oversized message is refused by size before it is parsed", async () => {
  const { adapter, out, session } = harness();
  await session.start();
  await session.handle(JSON.stringify({ t: "audio", seq: 1, pcm: "A".repeat(40_000) }));
  assert.equal(adapter.frames.length, 0);
  const error = out.at(-1);
  assert.equal(error?.t, "error");
  assert.equal(error.code, "frame_too_large");
});

test("stop closes the session and reports what was heard", async () => {
  const { adapter, out, session } = harness();
  await session.start();
  await session.handle(audio(0));
  adapter.say("a step budget", 0, 1200);
  assert.equal(await session.handle(JSON.stringify({ t: "stop" })), false);
  assert.equal(adapter.closed, true);
  assert.deepEqual(out.at(-1), {
    t: "closed",
    reason: "stopped",
    transcript: "a step budget",
    frames: 1,
  });
});

test("a session with no audio for the idle timeout closes itself", async () => {
  let clock = 1_000_000;
  const { out, session } = harness(() => clock);
  await session.start();
  await session.handle(audio(0));

  clock += IDLE_TIMEOUT_MS - 1;
  assert.equal(await session.tick(), true, "still inside the idle window");

  clock += 1;
  assert.equal(await session.tick(), false);
  assert.equal(session.closeReason, "idle");
  assert.equal(out.at(-1)?.t, "closed");
});

test("a session that runs past the ceiling closes even while audio arrives", async () => {
  let clock = 1_000_000;
  const { session } = harness(() => clock);
  await session.start();
  for (let at = 0; at <= SESSION_CEILING_MS; at += 60_000) {
    clock = 1_000_000 + at;
    await session.handle(audio(at / 100));
    if (!(await session.tick())) break;
  }
  assert.equal(session.closeReason, "ceiling");
});

/**
 * docs/07 section 12, item 9: a session abandoned mid-answer closes its
 * socket, saves the partial transcript and does not consume the allowance.
 * The allowance half lives in the application; this is the transport half.
 */
test("an abandoned session still reports the transcript it heard", async () => {
  const { adapter, out, session } = harness();
  await session.start();
  await session.handle(audio(0));
  adapter.say("the loop stops when", 0, 1500);
  await session.close("client_gone");
  assert.deepEqual(out.at(-1), {
    t: "closed",
    reason: "client_gone",
    transcript: "the loop stops when",
    frames: 1,
  });
});

test("a speech-to-text failure reaches the learner rather than dying quietly", async () => {
  const { adapter, out, session } = harness();
  await session.start();
  adapter.fail("Amazon Transcribe returned LimitExceededException.");
  const error = out.at(-1);
  assert.equal(error?.t, "error");
  assert.equal(error.code, "stt_failed");
  await session.close("stopped");
  const closed = out.at(-1);
  assert.equal(closed?.t, "closed");
  assert.equal(closed.reason, "failed", "a failed stream does not close as a clean stop");
});
