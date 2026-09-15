/**
 * The session token, which is the only thing standing between a stranger and
 * a socket that spends money on transcription.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mintVoiceToken,
  readVoiceToken,
  TokenRejected,
  TOKEN_TTL_S,
} from "../../web/lib/voice/token.ts";

const SECRET = "a-development-secret-that-is-not-in-any-deployment";
const CLAIMS = { sid: "41", eid: 7, qid: 3, mode: "guided" } as const;

test("a freshly minted token reads back with its claims", () => {
  const token = mintVoiceToken(CLAIMS, SECRET, 1_000);
  const claims = readVoiceToken(token, SECRET, 1_000);
  assert.equal(claims.sid, "41");
  assert.equal(claims.eid, 7);
  assert.equal(claims.qid, 3);
  assert.equal(claims.mode, "guided");
  assert.equal(claims.exp, 1_000 + TOKEN_TTL_S);
});

test("a token is worthless a minute after it is minted", () => {
  const token = mintVoiceToken(CLAIMS, SECRET, 1_000);
  assert.ok(readVoiceToken(token, SECRET, 1_000 + TOKEN_TTL_S - 1));
  assert.throws(() => readVoiceToken(token, SECRET, 1_000 + TOKEN_TTL_S), TokenRejected);
});

test("a claim cannot be edited without the secret", () => {
  const token = mintVoiceToken(CLAIMS, SECRET, 1_000);
  const [payload, signature] = token.split(".") as [string, string];

  // Promote the enrolment to somebody else's, keeping the old signature.
  const edited = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  edited.eid = 8;
  const forged = `${Buffer.from(JSON.stringify(edited)).toString("base64url")}.${signature}`;

  assert.throws(() => readVoiceToken(forged, SECRET, 1_000), /not signed by this application/);
});

test("a token signed with another secret is refused", () => {
  const token = mintVoiceToken(CLAIMS, "some-other-secret", 1_000);
  assert.throws(() => readVoiceToken(token, SECRET, 1_000), TokenRejected);
});

test("malformed input is refused rather than crashing the authorizer", () => {
  for (const attempt of ["", ".", "a.b.c", "notbase64.notasignature"]) {
    assert.throws(() => readVoiceToken(attempt, SECRET, 1_000), TokenRejected);
  }
});

test("an unset secret refuses everything rather than trusting everything", () => {
  assert.throws(() => mintVoiceToken(CLAIMS, "", 1_000), /VOICE_TOKEN_SECRET/);
  assert.throws(() => readVoiceToken("a.b", "", 1_000), /VOICE_TOKEN_SECRET/);
});
