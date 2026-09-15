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
 */
import { PollyClient, SynthesizeSpeechCommand, type Engine, type VoiceId } from "@aws-sdk/client-polly";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { db } from "../db/pool.ts";

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
    "select id, text from voice_follow_up where voice_question_id = $1 and audio_key is null",
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
    "select audio_key from voice_follow_up where id = $1 and voice_question_id = $2",
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
