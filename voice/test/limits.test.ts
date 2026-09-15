/**
 * The platform limits this application has to stay inside.
 *
 * Every number on the right of these assertions was read from the Amazon API
 * Gateway service quotas table in the AWS General Reference on 2026-09-15,
 * and every one of them is marked not adjustable there. The point of testing
 * a constant against a constant is that the left side is ours and moves, and
 * a change that pushed it over the platform's would otherwise only show up as
 * a socket closing for a reason the learner cannot be told.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FRAME_BYTES,
  FRAME_MS,
  IDLE_TIMEOUT_MS,
  PLATFORM_CONNECTION_MAX_MS,
  PLATFORM_IDLE_TIMEOUT_MS,
  SAMPLE_RATE,
  SESSION_CEILING_MS,
} from "../src/config.ts";
import { FRAME_LIMIT_BYTES, encodeFrame } from "../../web/lib/voice/protocol.ts";

test("the session idle timeout sits below the API Gateway idle timeout", () => {
  assert.equal(PLATFORM_IDLE_TIMEOUT_MS, 600_000);
  assert.ok(
    IDLE_TIMEOUT_MS < PLATFORM_IDLE_TIMEOUT_MS,
    `idle timeout ${IDLE_TIMEOUT_MS}ms must be under API Gateway's ${PLATFORM_IDLE_TIMEOUT_MS}ms`,
  );
});

test("the session ceiling sits below the API Gateway connection duration", () => {
  assert.equal(PLATFORM_CONNECTION_MAX_MS, 7_200_000);
  assert.ok(SESSION_CEILING_MS < PLATFORM_CONNECTION_MAX_MS);
});

test("the longest authored question fits inside the session ceiling", () => {
  // docs/07 section 2 authors total_seconds at 285 for the worked example.
  assert.ok(SESSION_CEILING_MS > 285_000 * 2);
});

test("one frame is the size Amazon Transcribe's own formula gives", () => {
  // chunk_size_in_bytes = chunk_duration_ms / 1000 * sample_rate * 2
  assert.equal(FRAME_BYTES, 3200);
  assert.equal(FRAME_BYTES % 2, 0, "single-channel PCM chunks hold an even number of bytes");
  assert.ok(FRAME_MS >= 50 && FRAME_MS <= 200, "the guide recommends 50ms to 200ms per chunk");
  assert.ok(SAMPLE_RATE >= 8000 && SAMPLE_RATE <= 48_000);
});

test("an encoded frame message fits well inside the WebSocket frame limit", () => {
  const frame = new Int16Array(FRAME_BYTES / 2).fill(-1234);
  const message = JSON.stringify({ t: "audio", seq: 999_999, pcm: encodeFrame(frame) });
  assert.ok(
    message.length < FRAME_LIMIT_BYTES / 4,
    `a frame message is ${message.length} bytes against a ${FRAME_LIMIT_BYTES} byte limit, ` +
      "which should leave room for several times over",
  );
});
