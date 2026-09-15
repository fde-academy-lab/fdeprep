/**
 * Phase 7a acceptance: the consent gate, the microphone check and the rule
 * that no transcript reaches the screen.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { closeDb, db } from "@/lib/db/pool";
import { consentState, ConsentRequired, grantConsent, revokeConsent } from "@/lib/voice/consent";
import { labQuestionId } from "@/lib/voice/lab";
import { startVoiceSession, VoiceNotConfigured } from "@/lib/voice/start";
import { HEARD_RMS, MIN_FRAMES, passesCheck, verdictFor } from "@/lib/voice/mic-check";
import { mintVoiceToken, readVoiceToken } from "@/lib/voice/token";
import { resetDatabase, seedLearner } from "./helpers.ts";

const SECRET = "a-test-secret";
const SOCKET = "ws://localhost:8787";

afterAll(async () => {
  await closeDb();
});

describe("the consent gate", () => {
  beforeEach(async () => {
    await resetDatabase();
    process.env.VOICE_TOKEN_SECRET = SECRET;
    process.env.VOICE_SOCKET_URL = SOCKET;
  });

  async function sessionCount(): Promise<number> {
    const { rows } = await db().query<{ count: string }>("select count(*) from voice_session");
    return Number(rows[0]!.count);
  }

  test("no session starts without a voice_consent row", async () => {
    const learner = await seedLearner();
    const questionId = await labQuestionId();

    await expect(
      startVoiceSession({
        enrolmentId: learner.enrolmentId,
        cohortId: learner.cohortId,
        voiceQuestionId: questionId,
        mode: "guided",
      }),
    ).rejects.toBeInstanceOf(ConsentRequired);

    expect(await sessionCount()).toBe(0);
  });

  test("a session starts once consent exists, and the token carries the claims", async () => {
    const learner = await seedLearner();
    const questionId = await labQuestionId();
    await grantConsent(learner.enrolmentId);

    const started = await startVoiceSession({
      enrolmentId: learner.enrolmentId,
      cohortId: learner.cohortId,
      voiceQuestionId: questionId,
      mode: "guided",
    });

    expect(started.socketUrl).toBe(SOCKET);
    expect(started.sampleRate).toBe(16_000);
    expect(await sessionCount()).toBe(1);

    const claims = readVoiceToken(started.token, SECRET);
    expect(claims.sid).toBe(String(started.sessionId));
    expect(claims.eid).toBe(learner.enrolmentId);
    expect(claims.qid).toBe(questionId);
    expect(claims.mode).toBe("guided");
  });

  // docs/07 section 12, item 1.
  test("consent is granted once and stays granted", async () => {
    const learner = await seedLearner();
    await grantConsent(learner.enrolmentId);
    await grantConsent(learner.enrolmentId);

    const { rows } = await db().query<{ count: string }>(
      "select count(*) from voice_consent where enrolment_id = $1",
      [learner.enrolmentId],
    );
    expect(Number(rows[0]!.count)).toBe(1);
    expect((await consentState(learner.enrolmentId)).granted).toBe(true);
  });

  test("withdrawing consent closes the gate again", async () => {
    const learner = await seedLearner();
    const questionId = await labQuestionId();
    await grantConsent(learner.enrolmentId);
    await revokeConsent(learner.enrolmentId);

    expect((await consentState(learner.enrolmentId)).granted).toBe(false);
    await expect(
      startVoiceSession({
        enrolmentId: learner.enrolmentId,
        cohortId: learner.cohortId,
        voiceQuestionId: questionId,
        mode: "guided",
      }),
    ).rejects.toBeInstanceOf(ConsentRequired);
  });

  test("an unconfigured socket refuses before it writes a row", async () => {
    const learner = await seedLearner();
    const questionId = await labQuestionId();
    await grantConsent(learner.enrolmentId);
    delete process.env.VOICE_SOCKET_URL;

    await expect(
      startVoiceSession({
        enrolmentId: learner.enrolmentId,
        cohortId: learner.cohortId,
        voiceQuestionId: questionId,
        mode: "guided",
      }),
    ).rejects.toBeInstanceOf(VoiceNotConfigured);
    expect(await sessionCount()).toBe(0);
  });

  test("the lab question is never published, so it cannot reach the catalogue", async () => {
    await labQuestionId();
    const { rows } = await db().query<{ is_published: boolean }>(
      "select is_published from voice_question where slug = '_lab-transport-check'",
    );
    expect(rows[0]!.is_published).toBe(false);
  });

  test("a minted token stops working after its minute", async () => {
    const token = mintVoiceToken({ sid: "1", eid: 1, qid: 1, mode: "guided" }, SECRET, 1_000);
    expect(() => readVoiceToken(token, SECRET, 1_200)).toThrow(/expired/);
  });
});

/**
 * docs/07 section 12, item 2: the microphone check detects a muted or absent
 * device before a session starts.
 */
describe("the microphone check", () => {
  const heard = { trackMuted: false, trackEnabled: true, frames: 50, peakRms: 0.2 };

  test("a normal five seconds of speech passes", () => {
    const verdict = verdictFor(heard);
    expect(verdict.ok).toBe(true);
    expect(passesCheck(verdict)).toBe(true);
  });

  test("a muted track fails whatever else looks fine", () => {
    const verdict = verdictFor({ ...heard, trackMuted: true });
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.kind).toBe("muted");
    expect(verdict.ok === false && verdict.message).toMatch(/Unmute it/);
  });

  test("a disabled track fails the same way", () => {
    const verdict = verdictFor({ ...heard, trackEnabled: false });
    expect(verdict.ok === false && verdict.kind).toBe("muted");
  });

  test("a device that delivered almost no audio fails as stalled", () => {
    const verdict = verdictFor({ ...heard, frames: MIN_FRAMES - 1 });
    expect(verdict.ok === false && verdict.kind).toBe("stalled");
  });

  test("an open but silent microphone fails rather than passing quietly", () => {
    const verdict = verdictFor({ ...heard, peakRms: HEARD_RMS - 0.001 });
    expect(verdict.ok === false && verdict.kind).toBe("silent");
  });

  test("nothing starts a session without a verdict", () => {
    expect(passesCheck(null)).toBe(false);
  });

  test("every failure names the next action", () => {
    for (const verdict of [
      verdictFor({ ...heard, trackMuted: true }),
      verdictFor({ ...heard, frames: 0 }),
      verdictFor({ ...heard, peakRms: 0 }),
    ]) {
      expect(verdict.ok === false && verdict.message).toMatch(/run (the check|it) again\./);
    }
  });
});

/**
 * docs/07 section 3 calls no live transcript "the single most important rule
 * in the module and the most likely one to get built wrong by default", and
 * CLAUDE.md carries it as a standing rule.
 *
 * A tripwire rather than a proof: it reads the only screen that receives
 * transcript text in this phase and insists every use of it goes to the
 * console. The cockpit in Phase 7b needs its own, stricter check.
 */
describe("no transcript reaches the screen", () => {
  test("the lab page logs transcript text and never renders it", async () => {
    const file = path.join(import.meta.dirname, "..", "app", "voice", "lab", "lab.tsx");
    const lines = (await readFile(file, "utf8")).split("\n");

    const offenders = lines.filter(
      (line, index) =>
        /message\.(text|transcript)/.test(line) &&
        // The call can wrap, so a use counts as logged when console appears on
        // the line or on either of the two above it.
        !/console\./.test(lines.slice(Math.max(0, index - 2), index + 1).join("\n")),
    );

    expect(offenders, `these lines use transcript text outside a console call:\n${offenders.join("\n")}`)
      .toEqual([]);
  });
});
