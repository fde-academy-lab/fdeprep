/**
 * An interviewer's voice. docs/07 section 2a and S13.4. Written before the code.
 *
 * Polly and S3 are replaced by stand-ins that count calls and keep objects in
 * a map, so the tests can say how often anything was synthesised and what was
 * stored, with no AWS account.
 *
 * - A line is synthesised once per voice and words, and served from the cache
 *   after that. Changed words are a new object.
 * - The authored follow-up is spoken in the chosen interviewer's voice, and in
 *   the deployment's own voice when none was chosen.
 * - The question and the opening line are spoken through one route that
 *   resolves the words on the server.
 * - With no bucket nothing is synthesised and the lobby writes the line out.
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";

const aws = vi.hoisted(() => ({
  polly: [] as Array<Record<string, unknown>>,
  objects: new Map<string, Uint8Array>(),
}));

vi.mock("@aws-sdk/client-polly", async (importOriginal) => {
  const real = await importOriginal<typeof import("@aws-sdk/client-polly")>();
  class PollyClient {
    async send(command: { input: Record<string, unknown> }) {
      aws.polly.push(command.input);
      const said = `${String(command.input.VoiceId)}: ${String(command.input.Text)}`;
      return {
        AudioStream: { transformToByteArray: async () => new TextEncoder().encode(said) },
        ContentType: "audio/mpeg",
      };
    }
  }
  return { ...real, PollyClient };
});

vi.mock("@aws-sdk/client-s3", async (importOriginal) => {
  const real = await importOriginal<typeof import("@aws-sdk/client-s3")>();
  class S3Client {
    async send(command: { input: { Key: string; Body?: Uint8Array } }) {
      if (command instanceof real.PutObjectCommand) {
        aws.objects.set(command.input.Key, command.input.Body!);
        return {};
      }
      const body = aws.objects.get(command.input.Key);
      return body ? { Body: { transformToByteArray: async () => body }, ContentType: "audio/mpeg" } : {};
    }
  }
  return { ...real, S3Client };
});

import { closeDb, db } from "@/lib/db/pool";
import { importVoiceQuestion } from "@/lib/voice/import";
import { importInterviewers } from "@/lib/voice/import-interviewers";
import { resolveInterviewer } from "@/lib/voice/interviewers";
import { loadQuestion, resolvePublishedQuestion } from "@/lib/voice/question";
import { lineKey, speakLine, textSha256, ttsConfig } from "@/lib/voice/tts";
import { InterviewerCard } from "@/components/voice/interviewer-card";
import { resetDatabase } from "./helpers.ts";

const REPO = path.join(import.meta.dirname, "..", "..");
const LOOP = path.join(REPO, "voice-questions", "agent-loop", "stop-an-agent-that-never-finishes.yaml");
const BRIAN = { id: "Brian", engine: "neural", language: "en-GB" };

async function importInterviewerDirectory(): Promise<void> {
  const dir = path.join(REPO, "voice-interviewers");
  const names = (await readdir(dir)).filter((name) => name.endsWith(".yaml"));
  await importInterviewers(await Promise.all(names.map(async (name) => ({
    source: await readFile(path.join(dir, name), "utf8"), file: name,
  }))));
}

async function publishLoop(): Promise<number> {
  await importVoiceQuestion(await readFile(LOOP, "utf8"), LOOP);
  return resolvePublishedQuestion("stop-an-agent-that-never-finishes");
}

const said = async (response: Response) => new TextDecoder().decode(await response.arrayBuffer());

afterAll(async () => {
  await closeDb();
});

beforeEach(async () => {
  await resetDatabase();
  aws.polly.length = 0;
  aws.objects.clear();
  process.env.VOICE_AUDIO_BUCKET = "a-bucket";
  delete process.env.VOICE_TTS_VOICE;
  await importInterviewerDirectory();
});

describe("a spoken line", () => {
  test("is synthesised once per voice and words, and served from the cache after", async () => {
    const first = await speakLine("Tell me what you would cut.", BRIAN);
    const second = await speakLine("Tell me what you would cut.", BRIAN);
    expect(first).toEqual(second);
    expect(first!.audioKey).toBe(lineKey("Brian", textSha256("Tell me what you would cut.")));
    expect(first!.audioKey).toMatch(/^voice\/lines\/Brian\/[0-9a-f]{64}\.mp3$/);
    expect(aws.polly).toHaveLength(1);
    expect(aws.polly[0]).toMatchObject({ VoiceId: "Brian", Engine: "neural", LanguageCode: "en-GB" });
    const { rows } = await db().query<{ n: string }>("select count(*) as n from voice_spoken_line");
    expect(Number(rows[0]!.n)).toBe(1);
  });

  test("changed words are a new object, and the same words in another voice are too", async () => {
    const before = await speakLine("Tell me what you would cut.", BRIAN);
    const after = await speakLine("Tell me what you would keep.", BRIAN);
    const another = await speakLine("Tell me what you would cut.", { id: "Amy", engine: "neural", language: "en-GB" });
    expect(new Set([before!.audioKey, after!.audioKey, another!.audioKey]).size).toBe(3);
    expect(aws.polly).toHaveLength(3);
  });

  test("with no bucket nothing is synthesised, and the lobby writes the opening line out", async () => {
    delete process.env.VOICE_AUDIO_BUCKET;
    expect(ttsConfig()).toBeNull();
    expect(await speakLine("Tell me what you would cut.", BRIAN)).toBeNull();
    expect(aws.polly).toHaveLength(0);

    const cto = await resolveInterviewer("cto");
    const card = (speaks: boolean) => renderToStaticMarkup(createElement(InterviewerCard, {
      interviewer: cto, questionId: 1, speaks,
    }));
    const quiet = card(false);
    expect(quiet).toContain("I have twenty minutes between two other things");
    expect(quiet).not.toContain("Hear the question");
    expect(card(true)).toContain("Hear the question");
  });
});

describe("the authored follow-up, spoken", () => {
  async function followUpAudio(query: string) {
    const questionId = await publishLoop();
    const question = await loadQuestion(questionId);
    const followUp = question.followUps[0]!;
    const { GET } = await import("../app/api/voice/questions/[id]/follow-ups/[followUpId]/audio/route.ts");
    const response = await GET(
      new Request(`http://local/api/voice/questions/${questionId}/follow-ups/${followUp.id}/audio${query}`),
      { params: Promise.resolve({ id: String(questionId), followUpId: String(followUp.id) }) });
    return { response, followUp };
  }

  test("is in the chosen interviewer's voice", async () => {
    const { response, followUp } = await followUpAudio("?interviewer=cto");
    expect(response.status).toBe(200);
    expect(await said(response)).toBe(`Brian: ${followUp.text}`);
    expect(aws.polly.map((input) => input.VoiceId)).toEqual(["Brian"]);
  });

  test("is in the deployment's own voice when none was chosen", async () => {
    const { response } = await followUpAudio("");
    expect(response.status).toBe(200);
    expect(new Set(aws.polly.map((input) => input.VoiceId))).toEqual(new Set(["Matthew"]));
  });

  test("on the panel, is in the chair's voice", async () => {
    const { response } = await followUpAudio("?interviewer=panel");
    expect(response.status).toBe(200);
    expect(aws.polly.map((input) => input.VoiceId)).toEqual(["Matthew"]);
  });
});

describe("the question and the opening line, spoken", () => {
  async function speech(interviewer: string, line: string, questionId?: number) {
    const id = questionId ?? await publishLoop();
    const { GET } = await import("../app/api/voice/questions/[id]/speech/[interviewer]/[line]/route.ts");
    return GET(new Request(`http://local/api/voice/questions/${id}/speech/${interviewer}/${line}`),
               { params: Promise.resolve({ id: String(id), interviewer, line }) });
  }

  test("reads the question and the opening line in the interviewer's voice, once each", async () => {
    const id = await publishLoop();
    const question = await loadQuestion(id);
    const prompt = await speech("client", "prompt", id);
    expect(await said(prompt)).toBe(`Kajal: ${question.promptText}`);
    const opening = await speech("client", "opening", id);
    expect(await said(opening)).toMatch(/^Kajal: Sunita Desai\. I own the number/);
    await speech("client", "opening", id);
    expect(aws.polly).toHaveLength(2);
    expect(aws.polly[0]).toMatchObject({ LanguageCode: "en-IN" });
  });

  test("refuses a line it does not know and an interviewer nobody wrote, with a sentence", async () => {
    const id = await publishLoop();
    for (const response of [await speech("client", "rubric", id), await speech("intern", "prompt", id)]) {
      expect(response.status).toBe(404);
      expect(((await response.json()) as { message: string }).message).toMatch(/\./);
    }
    expect(aws.polly).toHaveLength(0);
  });

  test("says the line is written on the page when no speech is configured", async () => {
    delete process.env.VOICE_AUDIO_BUCKET;
    const response = await speech("cto", "opening");
    expect(response.status).toBe(404);
    expect(((await response.json()) as { message: string }).message).toMatch(/written on the page/);
  });
});
