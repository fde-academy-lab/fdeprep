/**
 * Voice failures in the browser, handled. Written before the code.
 *
 * The cockpit treated any reply to Stop as saved, so a 500 showed "Answer
 * recorded" and a link to a debrief that did not exist, and an error page in
 * place of JSON threw out of Start with nothing on screen. lib/voice/save.ts
 * and lib/http/reply.ts now return a result with the learner's sentence in
 * it: saving retries, counts a 409 as saved by an earlier try, and keeps the
 * answer in the tab with Save again when it still fails. These run without a
 * browser, against a fetch that answers from a script.
 */
import { describe, expect, test } from "vitest";
import { readReply } from "@/lib/http/reply";
import { openSession, saveAnswer, socketLostNote, uploadRecording } from "@/lib/voice/save";

/** A fetch that answers from a script, one reply per call, and records what
 *  it was asked. A thrown entry is a network failure. */
function scripted(replies: (Response | Error)[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const next = replies.shift();
    if (!next) throw new Error("the script ran out of replies");
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetcher, calls };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const html = (status: number) =>
  new Response("<!DOCTYPE html><html><body>Internal Server Error</body></html>",
               { status, headers: { "content-type": "text/html" } });
const offline = () => new TypeError("Failed to fetch");
const noWait = { sleep: async () => undefined };
const payload = { transcript: "an answer", segments: [], timeline: { beats: [], nudges: [] } };

describe("reading a route's reply", () => {
  test("a JSON reply gives its message", async () => {
    const reply = await readReply(json(429, { message: "That is today's last answer." }));
    expect(reply).toMatchObject({ ok: false, status: 429, message: "That is today's last answer." });
  });

  test("an HTML error page gives no message and does not throw", async () => {
    await expect(readReply(html(500))).resolves.toMatchObject({ ok: false, status: 500, message: null });
  });

  test("an empty body gives no message and does not throw", async () => {
    await expect(readReply(new Response(null, { status: 502 })))
      .resolves.toMatchObject({ ok: false, status: 502, message: null });
  });
});

describe("opening a session from the cockpit", () => {
  const ask = { mode: "guided", question: "stop-an-agent-that-never-finishes" } as const;

  test("a session that opens hands back what the socket needs", async () => {
    const started = { sessionId: 7, token: "t", socketUrl: "ws://x", sampleRate: 16_000 };
    const { fetcher } = scripted([json(200, started)]);
    await expect(openSession(fetcher, ask)).resolves.toEqual({ ok: true, started });
  });

  test("a refusal shows the server's own sentence", async () => {
    const { fetcher } = scripted([json(429, { message: "That was today's last guided answer." })]);
    await expect(openSession(fetcher, ask))
      .resolves.toEqual({ ok: false, message: "That was today's last guided answer." });
  });

  test("an HTML 500 says the server failed and offers the typed answer", async () => {
    const { fetcher } = scripted([html(500)]);
    const result = await openSession(fetcher, ask);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/500/);
    expect(result.message).toMatch(/type the answer/i);
  });

  test("no connection says so and names Start as the next action", async () => {
    const { fetcher } = scripted([offline()]);
    const result = await openSession(fetcher, ask);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/could not reach the server/i);
    expect(result.message).toMatch(/start/i);
  });
});

describe("saving an answer from the cockpit", () => {
  test("a 200 is saved, first time", async () => {
    const { fetcher, calls } = scripted([json(200, { finished: 7 })]);
    await expect(saveAnswer(fetcher, 7, payload, noWait)).resolves.toEqual({ saved: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("/api/voice/sessions/7/finish");
  });

  test("a server failure is tried again, and a later success is saved", async () => {
    const { fetcher, calls } = scripted([html(502), offline(), json(200, { finished: 7 })]);
    await expect(saveAnswer(fetcher, 7, payload, noWait)).resolves.toEqual({ saved: true });
    expect(calls).toHaveLength(3);
  });

  test("a 409 counts as saved, because an earlier try finished the session", async () => {
    const { fetcher } = scripted([offline(), json(409, { message: "That voice session is already finished." })]);
    await expect(saveAnswer(fetcher, 7, payload, noWait)).resolves.toEqual({ saved: true });
  });

  test("a server that keeps failing leaves the answer unsaved, with Save again named", async () => {
    const { fetcher, calls } = scripted([html(500), html(500), html(500)]);
    const result = await saveAnswer(fetcher, 7, payload, noWait);
    expect(calls).toHaveLength(3);
    expect(result.saved).toBe(false);
    if (result.saved) return;
    // The screen's heading says it did not save, so the message gives the cause.
    expect(result.message).toMatch(/answered 500 three times/i);
    expect(result.message).toMatch(/still in this tab/i);
    expect(result.message).toMatch(/save again/i);
  });

  test("no connection at all says so", async () => {
    const { fetcher } = scripted([offline(), offline(), offline()]);
    const result = await saveAnswer(fetcher, 7, payload, noWait);
    expect(result.saved).toBe(false);
    if (result.saved) return;
    expect(result.message).toMatch(/could not reach the server/i);
  });

  test("a refusal is not repeated, since the same request would be refused again", async () => {
    const { fetcher, calls } = scripted([json(400, { message: "Needs a timeline." })]);
    const result = await saveAnswer(fetcher, 7, payload, noWait);
    expect(calls).toHaveLength(1);
    expect(result.saved).toBe(false);
  });

  test("a session that ended says to sign in again and come back to this tab", async () => {
    const { fetcher, calls } = scripted([json(401, { message: "Your session has ended." })]);
    const result = await saveAnswer(fetcher, 7, payload, noWait);
    expect(calls).toHaveLength(1);
    expect(result.saved).toBe(false);
    if (result.saved) return;
    expect(result.message).toMatch(/sign in again/i);
    expect(result.message).toMatch(/save again/i);
  });
});

describe("storing the recording", () => {
  const recording = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" });

  test("a stored recording says nothing", async () => {
    const { fetcher } = scripted([json(200, { stored: true })]);
    await expect(uploadRecording(fetcher, 7, recording)).resolves.toEqual({ stored: true, message: null });
  });

  test("no bucket on this machine says nothing either, since the debrief replays without it", async () => {
    const { fetcher } = scripted([json(200, { stored: false })]);
    await expect(uploadRecording(fetcher, 7, recording)).resolves.toEqual({ stored: false, message: null });
  });

  test("a failed upload says the answer is saved and the recording is not", async () => {
    const { fetcher } = scripted([html(500)]);
    const result = await uploadRecording(fetcher, 7, recording);
    expect(result.stored).toBe(false);
    expect(result.message).toMatch(/answer is saved/i);
    expect(result.message).toMatch(/recording was not stored/i);
  });
});

describe("the socket closing mid-answer", () => {
  test("each reason the socket gives reads as what happened and what to press", () => {
    for (const reason of ["idle", "ceiling", "failed", "client_gone", null] as const) {
      const note = socketLostNote(reason, 72_000);
      expect(note, String(reason)).toMatch(/1:12/);
      expect(note, String(reason)).toMatch(/stop and debrief/i);
      expect(note, String(reason)).toMatch(/kept/i);
    }
  });

  test("a transcriber failure and a dropped connection read differently", () => {
    expect(socketLostNote("failed", 1_000)).toMatch(/transcriber failed/i);
    expect(socketLostNote(null, 1_000)).toMatch(/connection/i);
  });
});
