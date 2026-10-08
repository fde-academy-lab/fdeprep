/**
 * Speaking a pressure-mode follow-up. docs/07 sections 5 and 7.
 *
 * "Generate once per question and cache the audio in S3, since question text
 * rarely changes and re-synthesising on every session wastes money for no
 * benefit." So synthesis happens at most once per follow-up, the key is
 * stored on the row, and every later session streams the object.
 *
 * Verified 2026-09-15 against the Amazon Polly SynthesizeSpeech API reference
 * and the Available Voices table:
 *
 *   OutputFormat   required; json | mp3 | ogg_opus | ogg_vorbis | pcm |
 *                  mulaw | alaw. mp3 returns ContentType audio/mpeg, which
 *                  is what an <audio> element wants.
 *   Engine         standard | neural | long-form | generative, and the voice
 *                  has to support the one chosen.
 *   VoiceId        required.
 *   Matthew        en-US, Neural yes, Standard no. So the default pairing
 *                  below is Matthew on neural, which the table allows.
 *   Text limit     6,000 characters, of which 3,000 billed. A follow-up is a
 *                  sentence, so this is checked rather than worried about.
 *
 * When no bucket is configured there is no synthesis and no failure: the
 * cockpit shows the follow-up as text. docs/07 section 5 wants the learner
 * interrupted; hearing it is better and reading it still interrupts.
 *
 * Amended 9 October 2026, docs/07 section 2a: an interviewer speaks in their
 * own voice. speakLine caches any line said more than once, the question and
 * the opening line read by an interviewer, an authored follow-up in their
 * voice and their own probes, once per voice and text in voice_spoken_line,
 * under voice/lines/<voice>/<sha256>.mp3. Keyed on the hash of the words, so a
 * changed line is a new object and the old one is never served for the new
 * words. Checked again on 8 October 2026 against @aws-sdk/client-polly
 * 3.1132.0: SynthesizeSpeechCommand takes LanguageCode, which the en-IN voice
 * needs so it reads English, and the VoiceId type carries every voice in
 * lib/voice/interviewers.ts.
 */
import { createHash } from "node:crypto";
import {
  PollyClient, SynthesizeSpeechCommand, type Engine, type LanguageCode, type VoiceId,
} from "@aws-sdk/client-polly";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { db } from "../db/pool.ts";
import { POLLY_VOICES, type Voice } from "./interviewers.ts";

/** Polly's own documented ceiling for SynthesizeSpeech. */
export const TEXT_LIMIT = 6_000;

export type TtsConfig = { bucket: string; region: string; voiceId: VoiceId; engine: Engine };

export function ttsConfig(env: NodeJS.ProcessEnv = process.env): TtsConfig | null {
  const bucket = env.VOICE_AUDIO_BUCKET;
  if (!bucket) return null;
  return {
    bucket,
    region: env.AWS_REGION ?? "eu-west-1",
    voiceId: (env.VOICE_TTS_VOICE ?? "Matthew") as VoiceId,
    engine: (env.VOICE_TTS_ENGINE ?? "neural") as Engine,
  };
}

function keyFor(questionId: number, followUpId: number): string {
  return `voice/follow-ups/${questionId}/${followUpId}.mp3`;
}

export class TextTooLong extends Error {}

/**
 * Synthesise every follow-up of this question that has no audio yet, and
 * record the keys. Returns how many were synthesised, which is zero on every
 * call after the first.
 */
export async function ensureFollowUpAudio(questionId: number): Promise<number> {
  const config = ttsConfig();
  if (!config) return 0;

  const pool = db();
  const { rows } = await pool.query<{ id: string; text: string }>(
    `select id, text from voice_follow_up
      where voice_question_id = $1 and audio_key is null and retired_at is null`,
    [questionId],
  );
  if (rows.length === 0) return 0;

  const polly = new PollyClient({ region: config.region });
  const s3 = new S3Client({ region: config.region });
  let made = 0;

  for (const row of rows) {
    if (row.text.length > TEXT_LIMIT) {
      throw new TextTooLong(
        `Follow-up ${row.id} is ${row.text.length} characters, over Polly's ${TEXT_LIMIT} ` +
          "character limit for one request. Shorten it.",
      );
    }

    const spoken = await polly.send(
      new SynthesizeSpeechCommand({
        Text: row.text,
        TextType: "text",
        OutputFormat: "mp3",
        VoiceId: config.voiceId,
        Engine: config.engine,
      }),
    );
    if (!spoken.AudioStream) {
      throw new Error(`Polly returned no audio for follow-up ${row.id}.`);
    }

    const key = keyFor(questionId, Number(row.id));
    await s3.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        Body: await spoken.AudioStream.transformToByteArray(),
        ContentType: spoken.ContentType ?? "audio/mpeg",
      }),
    );
    await pool.query("update voice_follow_up set audio_key = $2 where id = $1", [row.id, key]);
    made += 1;
  }

  return made;
}

/** The voice a line is read in when no interviewer was chosen: the
 *  deployment's own, VOICE_TTS_VOICE on VOICE_TTS_ENGINE. Its language is the
 *  one the verified list gives it, or none for a voice off the list, and then
 *  Polly reads in the voice's own language. */
export function defaultVoice(config: TtsConfig): Voice {
  return { id: config.voiceId, engine: config.engine, language: POLLY_VOICES[config.voiceId] ?? "" };
}

export function textSha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Where a cached line lives in the bucket. Never handed to a browser. */
export function lineKey(voiceId: string, sha256: string): string {
  return `voice/lines/${voiceId}/${sha256}.mp3`;
}

async function synthesise(text: string, voice: Voice, config: TtsConfig): Promise<{
  body: Uint8Array; contentType: string;
}> {
  if (text.length > TEXT_LIMIT) {
    throw new TextTooLong(
      `A line of ${text.length} characters is over Polly's ${TEXT_LIMIT} character limit for ` +
        "one request. Shorten it.");
  }
  const polly = new PollyClient({ region: config.region });
  const spoken = await polly.send(new SynthesizeSpeechCommand({
    Text: text,
    TextType: "text",
    OutputFormat: "mp3",
    VoiceId: voice.id as VoiceId,
    Engine: voice.engine as Engine,
    ...(voice.language ? { LanguageCode: voice.language as LanguageCode } : {}),
  }));
  if (!spoken.AudioStream) throw new Error(`Polly returned no audio in the voice ${voice.id}.`);
  return {
    body: await spoken.AudioStream.transformToByteArray(),
    contentType: spoken.ContentType ?? "audio/mpeg",
  };
}

/** Put synthesised speech in the bucket under the key given. */
export async function putSpeech(
  key: string, audio: { body: Uint8Array; contentType: string }, config: TtsConfig,
): Promise<void> {
  const s3 = new S3Client({ region: config.region });
  await s3.send(new PutObjectCommand({
    Bucket: config.bucket, Key: key, Body: audio.body, ContentType: audio.contentType,
  }));
}

/**
 * Speak a line in a voice, once. The first call synthesises it and records
 * the key; every later call for the same voice and the same words returns
 * that key without reaching Polly. Null when no bucket is configured, which
 * is the caller's cue to show the line as text.
 *
 * Two first requests at once both synthesise and the second insert does
 * nothing, which costs one extra synthesis and serves the same words.
 */
export async function speakLine(text: string, voice: Voice): Promise<{ audioKey: string } | null> {
  const config = ttsConfig();
  if (!config) return null;
  const words = text.trim();
  const sha256 = textSha256(words);

  const { rows } = await db().query<{ audio_key: string }>(
    "select audio_key from voice_spoken_line where voice_id = $1 and text_sha256 = $2",
    [voice.id, sha256]);
  if (rows[0]) return { audioKey: rows[0].audio_key };

  const key = lineKey(voice.id, sha256);
  await putSpeech(key, await synthesise(words, voice, config), config);
  await db().query(
    `insert into voice_spoken_line (voice_id, text_sha256, audio_key) values ($1, $2, $3)
     on conflict (voice_id, text_sha256) do nothing`,
    [voice.id, sha256, key]);
  return { audioKey: key };
}

/** A stored object's bytes, by key, or null when nothing is stored or no
 *  bucket is configured. Routes stream these, so no bucket address reaches a
 *  browser. */
export async function storedSpeech(
  key: string,
): Promise<{ body: Uint8Array; contentType: string } | null> {
  const config = ttsConfig();
  if (!config) return null;
  const s3 = new S3Client({ region: config.region });
  const object = await s3.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
  if (!object.Body) return null;
  return {
    body: await object.Body.transformToByteArray(),
    contentType: object.ContentType ?? "audio/mpeg",
  };
}

/** A line in a voice, synthesised on first use: the speech routes' one call. */
export async function spokenLineAudio(
  text: string, voice: Voice,
): Promise<{ body: Uint8Array; contentType: string } | null> {
  const spoken = await speakLine(text, voice);
  return spoken ? storedSpeech(spoken.audioKey) : null;
}

/** The cached object's bytes, or null when there is nothing stored. The route
 *  streams these rather than handing the browser a bucket path, so no S3
 *  address ever reaches a client. */
export async function followUpAudio(
  questionId: number,
  followUpId: number,
): Promise<{ body: Uint8Array; contentType: string } | null> {
  const config = ttsConfig();
  if (!config) return null;

  const { rows } = await db().query<{ audio_key: string | null }>(
    `select audio_key from voice_follow_up
      where id = $1 and voice_question_id = $2 and retired_at is null`,
    [followUpId, questionId],
  );
  const key = rows[0]?.audio_key;
  if (!key) return null;

  const s3 = new S3Client({ region: config.region });
  const object = await s3.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
  if (!object.Body) return null;
  return {
    body: await object.Body.transformToByteArray(),
    contentType: object.ContentType ?? "audio/mpeg",
  };
}
