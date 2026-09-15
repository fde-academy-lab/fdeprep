/**
 * What the adapter asks Amazon Transcribe for.
 *
 * Asserted against the request the SDK command carries, with no network and
 * no credential, because the thing worth pinning is that the encoding, the
 * sample rate and the session id are the ones the service documents and not
 * whichever ones happened to be in memory when this was written.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { TranscribeStreamingClient } from "@aws-sdk/client-transcribe-streaming";
import { loadConfig } from "../src/config.ts";
import { sttSessionIdFor } from "../src/ids.ts";
import { TranscribeAdapter } from "../src/stt/transcribe.ts";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

/** Captures the command instead of sending it, and hands back a result stream
 *  the test scripts. */
function stub(events: unknown[] = []) {
  const sent: Record<string, unknown>[] = [];
  const client = {
    send(command: { input: Record<string, unknown> }) {
      sent.push(command.input);
      return Promise.resolve({
        TranscriptResultStream: (async function* () {
          for (const event of events) yield event;
        })(),
      });
    },
    destroy() {},
  } as unknown as TranscribeStreamingClient;
  return { client, sent };
}

function transcriptEvent(text: string, isPartial: boolean, start: number, end: number) {
  return {
    TranscriptEvent: {
      Transcript: {
        Results: [
          {
            IsPartial: isPartial,
            StartTime: start,
            EndTime: end,
            Alternatives: [{ Transcript: text }],
          },
        ],
      },
    },
  };
}

test("the stream is opened as 16kHz signed 16-bit PCM in the configured language", async () => {
  const { client, sent } = stub();
  const config = loadConfig({ VOICE_STT: "transcribe", AWS_REGION: "eu-west-1" });
  const adapter = new TranscribeAdapter(config, client);
  const sessionId = sttSessionIdFor("connection-1");

  await adapter.open(sessionId, { sampleRate: 16_000, language: "en-US" });

  const input = sent[0]!;
  assert.equal(input.MediaEncoding, "pcm");
  assert.equal(input.MediaSampleRateHertz, 16_000);
  assert.equal(input.LanguageCode, "en-US");
  assert.equal(input.SessionId, sessionId);
  // Minutes, per both the API reference and the SDK's own doc comment.
  assert.equal(input.SessionResumeWindow, 20);
  assert.equal(input.EnablePartialResultsStabilization, false);
  assert.equal(input.PartialResultsStability, undefined);
  await adapter.close();
});

test("stabilization is off unless configuration turns it on", async () => {
  const { client, sent } = stub();
  const config = loadConfig({ VOICE_STT: "transcribe", VOICE_STABILIZE_PARTIALS: "1" });
  const adapter = new TranscribeAdapter(config, client);
  await adapter.open(sttSessionIdFor("c"), { sampleRate: 16_000, language: "en-US" });
  assert.equal(sent[0]!.EnablePartialResultsStabilization, true);
  assert.equal(sent[0]!.PartialResultsStability, "medium");
  await adapter.close();
});

test("a session id that is not a UUID is refused here rather than by the service", async () => {
  const { client } = stub();
  const adapter = new TranscribeAdapter(loadConfig({ VOICE_STT: "transcribe" }), client);
  await assert.rejects(
    adapter.open("voice-session-41", { sampleRate: 16_000, language: "en-US" }),
    /UUID session id/,
  );
});

test("seconds from the service become the milliseconds the adapter contract uses", async () => {
  const { client } = stub([
    transcriptEvent("a step", true, 1.056, 1.056),
    transcriptEvent("a step budget", false, 1.056, 3.2104),
  ]);
  const adapter = new TranscribeAdapter(loadConfig({ VOICE_STT: "transcribe" }), client);
  const partials: [string, number][] = [];
  const finals: [string, number, number][] = [];
  adapter.onPartial((text, startMs) => partials.push([text, startMs]));
  adapter.onFinal((text, startMs, endMs) => finals.push([text, startMs, endMs]));

  await adapter.open(sttSessionIdFor("c"), { sampleRate: 16_000, language: "en-US" });
  await adapter.close();

  assert.deepEqual(partials, [["a step", 1056]]);
  assert.deepEqual(finals, [["a step budget", 1056, 3210]]);
});

test("an exception member on the result stream surfaces as an error", async () => {
  const { client } = stub([{ LimitExceededException: { message: "too many streams" } }]);
  const adapter = new TranscribeAdapter(loadConfig({ VOICE_STT: "transcribe" }), client);
  const errors: string[] = [];
  adapter.onError((error) => errors.push(error.message));
  await adapter.open(sttSessionIdFor("c"), { sampleRate: 16_000, language: "en-US" });
  await adapter.close();
  assert.deepEqual(errors, ["Amazon Transcribe returned LimitExceededException."]);
});

test("the derived session id is stable, well formed and per connection", () => {
  const first = sttSessionIdFor("Fq3Kd=abc");
  assert.match(first, UUID);
  assert.equal(first, sttSessionIdFor("Fq3Kd=abc"), "a resumed segment must present the same id");
  assert.notEqual(first, sttSessionIdFor("Fq3Kd=abd"));
  assert.equal(first[14], "5", "version nibble");
  assert.ok("89ab".includes(first[19]!), "RFC 4122 variant");
});
