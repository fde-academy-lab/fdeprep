/**
 * Learner audio: storing it, serving it, deleting it, sharing it.
 * docs/07 section 9.
 *
 * | Rule | Where it lives |
 * |---|---|
 * | Retention 30 days | An S3 lifecycle rule on the bucket, in infra/. This
 *   module records the deletion in audio_deleted_at when the object is gone. |
 * | The learner can delete their own audio at any time | deleteAudio, below.
 *   Immediate, irreversible, and the score stays: nothing here touches a
 *   score column. |
 * | Faculty access is not automatic | readAudio refuses unless the reader is
 *   the learner or the learner has shared that session. |
 * | No audio leaves the account | The object never leaves S3 except through
 *   this application, which streams it. No signed URL is minted, so no
 *   address that works without this application exists. |
 */
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client }
  from "@aws-sdk/client-s3";
import { db } from "../db/pool.ts";

/** docs/07 section 9. Matched by the lifecycle rule in infra/, which is what
 *  actually deletes; this is the number the copy quotes so the two cannot
 *  drift without the test noticing. */
export const RETENTION_DAYS = 30;

export class AudioNotConfigured extends Error {
  readonly status = 503;
}
export class AudioForbidden extends Error {
  readonly status = 403;
}

export function audioConfig(env: NodeJS.ProcessEnv = process.env) {
  const bucket = env.VOICE_AUDIO_BUCKET;
  if (!bucket) return null;
  return { bucket, region: env.AWS_REGION ?? "eu-west-1" };
}

function keyFor(sessionId: number): string {
  return `voice/answers/${sessionId}.webm`;
}

/**
 * Store the MediaRecorder copy.
 *
 * Returns false when no bucket is configured, which is the state on a
 * developer machine. The session is still scored and the debrief still works;
 * instrument replay runs on its own clock instead of the audio's.
 */
export async function storeAudio(input: {
  sessionId: number;
  enrolmentId: number;
  body: Uint8Array;
  contentType: string;
}): Promise<boolean> {
  const config = audioConfig();
  if (!config) return false;

  const { rows } = await db().query<{ id: string }>(
    "select id from voice_session where id = $1 and enrolment_id = $2",
    [input.sessionId, input.enrolmentId],
  );
  if (!rows[0]) throw new AudioForbidden("That session is not yours.");

  const key = keyFor(input.sessionId);
  await new S3Client({ region: config.region }).send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: input.body,
      ContentType: input.contentType,
    }),
  );
  await db().query(
    "update voice_session set audio_s3_key = $2, audio_deleted_at = null where id = $1",
    [input.sessionId, key],
  );
  return true;
}

/**
 * Who may hear a recording.
 *
 * The learner, always. Faculty and admin only when the learner has shared
 * that one session and not withdrawn it. Everyone else, never. docs/07
 * section 9 is explicit that faculty access is not automatic, so this refuses
 * by default and the share is the only thing that opens it.
 */
export async function mayHear(input: {
  sessionId: number;
  enrolmentId: number;
  role: "learner" | "faculty" | "admin";
}): Promise<boolean> {
  const { rows } = await db().query<{ owner: boolean; shared: boolean }>(
    `select s.enrolment_id = $2 as owner,
            coalesce(sh.id is not null and sh.withdrawn_at is null, false) as shared
       from voice_session s
       left join voice_session_share sh on sh.voice_session_id = s.id
      where s.id = $1`,
    [input.sessionId, input.enrolmentId],
  );
  const row = rows[0];
  if (!row) return false;
  if (row.owner) return true;
  return row.shared && (input.role === "faculty" || input.role === "admin");
}

export async function readAudio(input: {
  sessionId: number;
  enrolmentId: number;
  role: "learner" | "faculty" | "admin";
}): Promise<{ body: Uint8Array; contentType: string } | null> {
  if (!(await mayHear(input))) {
    throw new AudioForbidden(
      "That recording has not been shared with you. Only the learner can share a session.",
    );
  }

  const config = audioConfig();
  if (!config) return null;

  const { rows } = await db().query<{ audio_s3_key: string | null; audio_deleted_at: Date | null }>(
    "select audio_s3_key, audio_deleted_at from voice_session where id = $1",
    [input.sessionId],
  );
  const row = rows[0];
  if (!row?.audio_s3_key || row.audio_deleted_at) return null;

  const object = await new S3Client({ region: config.region }).send(
    new GetObjectCommand({ Bucket: config.bucket, Key: row.audio_s3_key }),
  );
  if (!object.Body) return null;
  return {
    body: await object.Body.transformToByteArray(),
    contentType: object.ContentType ?? "audio/webm",
  };
}

/**
 * Delete a recording. Immediate, irreversible, and the score stays.
 *
 * The score columns are not in the update, which is the point: docs/07
 * section 9 promises a learner that deleting the audio costs them nothing
 * they earned, and the cheapest way to keep that promise is for the delete
 * statement to be unable to break it.
 */
export async function deleteAudio(input: {
  sessionId: number;
  enrolmentId: number;
}): Promise<void> {
  const { rows } = await db().query<{ audio_s3_key: string | null }>(
    "select audio_s3_key from voice_session where id = $1 and enrolment_id = $2",
    [input.sessionId, input.enrolmentId],
  );
  if (!rows[0]) throw new AudioForbidden("That session is not yours.");

  const config = audioConfig();
  const key = rows[0].audio_s3_key;
  if (config && key) {
    await new S3Client({ region: config.region }).send(
      new DeleteObjectCommand({ Bucket: config.bucket, Key: key }),
    );
  }

  await db().query(
    "update voice_session set audio_deleted_at = now(), audio_s3_key = null where id = $1",
    [input.sessionId],
  );
}

/** Share one session's audio with faculty, or withdraw the share. */
export async function setShare(input: {
  sessionId: number;
  enrolmentId: number;
  shared: boolean;
}): Promise<void> {
  const { rows } = await db().query<{ id: string }>(
    "select id from voice_session where id = $1 and enrolment_id = $2",
    [input.sessionId, input.enrolmentId],
  );
  if (!rows[0]) throw new AudioForbidden("That session is not yours.");

  if (input.shared) {
    await db().query(
      `insert into voice_session_share (voice_session_id) values ($1)
       on conflict (voice_session_id) do update set withdrawn_at = null, shared_at = now()`,
      [input.sessionId],
    );
  } else {
    await db().query(
      "update voice_session_share set withdrawn_at = now() where voice_session_id = $1",
      [input.sessionId],
    );
  }
}
