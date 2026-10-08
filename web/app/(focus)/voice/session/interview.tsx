"use client";

/**
 * Interview mode's follow-up rounds, after the main answer. docs/07 section 5a.
 *
 * A round has three phases, and each shows fewer than the main answer's five
 * instruments:
 *
 *   waiting    the question's title, the clock header, one line saying the
 *              interviewer is thinking, the microphone idle
 *   listening  who is asking and which round, the audio playing, Hear it
 *              again and Answer now. The question's words appear here only
 *              when there is no audio to play, and nowhere else, ever.
 *   replying   the sixty second clock, the microphone level, Done answering
 *              and the nudge slot
 *
 * The rules this file is built around are the cockpit's. No transcript text
 * on screen: what the transcriber hears lands in a ref and goes to the server
 * when the reply ends. No model call while the learner replies: the reply
 * engine, lib/voice/reply.ts, imports nothing, and the only request this file
 * makes is the reply's finish, after the reply has ended. The round's words
 * are drawn in one place, guarded by the listening phase and a missing audio
 * address, and tests/cockpit.test.ts fails on any other use.
 *
 * Each reply is its own socket, opened with the round's token while the
 * interviewer is speaking so the handshake is done before the first frame,
 * and closed with stop when the reply ends.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { encodePcm, startCapture, type Capture } from "@/lib/voice/capture";
import { clock } from "@/lib/voice/clock";
import type { ServerMessage } from "@/lib/voice/protocol";
import { ReplyRun } from "@/lib/voice/reply";
import { finishReply, type Fetcher, type Reply } from "@/lib/voice/save";
import type { TurnView } from "@/lib/voice/turns";
import { Announcer, MicLevel, NudgeSlot } from "./instruments";

/** fetch, called as a plain function so it is never invoked on another object. */
const send: Fetcher = (url, init) => fetch(url, init);

/** The same floor the cockpit and the microphone check use. */
const VOICED_RMS = 0.01;
const TICK_MS = 100;
/** How long the end of a reply waits for the transcriber's last words. */
const CLOSE_WAIT_MS = 1_500;
/** How long a nudge stays in the slot, as in the cockpit. */
const NUDGE_LIFETIME_MS = 8_000;

type Phase = "waiting" | "listening" | "replying" | "closed" | "unsaved";

type Segment = { text: string; startMs: number; endMs: number };

export function Interview({ sessionId, first, title, asker, nextHref, note }: {
  sessionId: number;
  /** Round 1, as the main answer's finish returned it. */
  first: TurnView;
  /** The question's title, for the header. */
  title: string;
  /** Who is thinking between rounds: the interviewer, or the panel. */
  asker: string;
  nextHref: { pathname: "/voice/session"; query: Record<string, string> } | null;
  /** A sentence from the session's opening, such as a resume that could not
   *  be read, shown between rounds and never during a reply. */
  note?: string | null;
}) {
  const router = useRouter();
  const [turn, setTurn] = useState<TurnView>(first);
  const [phase, setPhase] = useState<Phase>("listening");
  const [rms, setRms] = useState(0);
  const [remainingMs, setRemainingMs] = useState(first.seconds * 1000);
  const [nudgeLine, setNudgeLine] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [unsaved, setUnsaved] = useState<string | null>(null);
  const [heard, setHeard] = useState(0);

  /** What the transcriber heard. A ref, so nothing on screen can read it. */
  const transcript = useRef({ partial: "", finals: [] as Segment[] });
  const socket = useRef<WebSocket | null>(null);
  const capture = useRef<Capture | null>(null);
  const run = useRef<ReplyRun | null>(null);
  const seq = useRef(0);
  const startedAt = useRef(0);
  const voicedAt = useRef(0);
  const nudgeShownAt = useRef<number | null>(null);
  const drained = useRef<(() => void) | null>(null);
  /** Set once a reply has begun to end, so Done, the clock, Stop and the tab
   *  closing cannot each end it again. */
  const ending = useRef(false);
  /** A reply the server has not taken yet, kept for Save again. */
  const pending = useRef<{ ordinal: number; reply: Reply; leave: boolean } | null>(null);

  const reset = useCallback(() => {
    transcript.current = { partial: "", finals: [] };
    seq.current = 0;
    startedAt.current = 0;
    run.current = null;
    ending.current = false;
    nudgeShownAt.current = null;
    setNudgeLine(null);
    setRemainingMs(turn.seconds * 1000);
  }, [turn.seconds]);

  /** The reply's connection, opened as the round begins. */
  useEffect(() => {
    if (phase !== "listening") return;
    reset();
    let ws: WebSocket;
    try {
      ws = new WebSocket(`${turn.socketUrl}?token=${encodeURIComponent(turn.token)}`);
    } catch {
      setProblem("This reply cannot be heard, because the voice socket address is not one a browser " +
                 "can open. Press Stop and debrief to keep what you have said so far.");
      return;
    }
    socket.current = ws;
    ws.onmessage = (event) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(event.data as string) as ServerMessage;
      } catch {
        return;
      }
      // Both branches write to a ref, which nothing renders.
      if (message.t === "partial") transcript.current.partial = message.text;
      else if (message.t === "final") {
        transcript.current.finals.push({ text: message.text, startMs: message.startMs, endMs: message.endMs });
        transcript.current.partial = "";
      } else if (message.t === "closed") {
        drained.current?.();
      } else if (message.t === "error") {
        setProblem(message.message);
      }
    };
    ws.onerror = () => {
      setProblem("The voice socket failed, so this reply is not being heard. Press Done answering to " +
                 "move on, or Stop and debrief.");
    };
    return () => {
      // A round that never reached its reply closes its connection here.
      if (socket.current === ws && ws.readyState !== WebSocket.CLOSED && !capture.current) ws.close();
    };
  }, [phase, reset, turn.socketUrl, turn.token]);

  useEffect(() => {
    if (phase === "listening") {
      setAnnouncement(`Round ${turn.turn} of ${turn.rounds}. ${turn.interviewer.name} asks.`);
    }
  }, [phase, turn.interviewer.name, turn.rounds, turn.turn]);

  /** The words the learner said in this reply, joined, for the server only. */
  const said = useCallback(() => {
    const { finals, partial } = transcript.current;
    const segments = partial.trim()
      ? [...finals, { text: partial.trim(), startMs: Date.now() - startedAt.current,
                      endMs: Date.now() - startedAt.current }]
      : finals;
    return { transcript: segments.map((segment) => segment.text).join(" "), segments };
  }, []);

  /** Store the reply and move on to the next round, or the end. */
  const store = useCallback(async (ordinal: number, reply: Reply, leave: boolean) => {
    setPhase("waiting");
    const result = await finishReply(send, sessionId, ordinal, reply);
    if (!result.saved) {
      pending.current = { ordinal, reply, leave };
      setUnsaved(result.message);
      setPhase("unsaved");
      return;
    }
    pending.current = null;
    setUnsaved(null);
    if (leave && nextHref) {
      router.push(`/voice/session?${new URLSearchParams(nextHref.query).toString()}` as Route);
      return;
    }
    if (result.closed || !result.turn) {
      setPhase("closed");
      router.refresh();
      return;
    }
    setProblem(null);
    setTurn(result.turn);
    setPhase("listening");
  }, [nextHref, router, sessionId]);

  /**
   * End the reply: the microphone first, then stop, a short wait for the
   * transcriber's last words, and the reply's one request. `close` is Stop and
   * debrief or Next question, which ends the interview.
   */
  const endReply = useCallback(async (close: boolean, leave = false) => {
    if (ending.current) return;
    ending.current = true;
    const microphone = capture.current;
    capture.current = null;
    await microphone?.stop().catch(() => null);
    const ws = socket.current;
    socket.current = null;
    if (ws && ws.readyState === WebSocket.OPEN) {
      const heardAll = new Promise<void>((resolve) => { drained.current = resolve; });
      ws.send(JSON.stringify({ t: "stop" }));
      await Promise.race([heardAll, new Promise((resolve) => setTimeout(resolve, CLOSE_WAIT_MS))]);
      drained.current = null;
    }
    ws?.close();
    setRms(0);
    const replyMs = startedAt.current ? Date.now() - startedAt.current : 0;
    await store(turn.turn, { ...said(), replyMs, close }, leave);
  }, [said, store, turn.turn]);

  const startReply = useCallback(async () => {
    if (phase !== "listening") return;
    const ws = socket.current;
    let microphone: Capture;
    try {
      microphone = await startCapture({
        record: false,
        onFrame: ({ pcm, rms: level }) => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ t: "audio", seq: seq.current++, pcm: encodePcm(pcm) }));
          }
          setRms(level);
          if (level >= VOICED_RMS) voicedAt.current = Date.now();
        },
      });
    } catch {
      setProblem("The microphone could not be opened, so this reply cannot be heard. Check the " +
                 "browser's permission for this site, then press Stop and debrief.");
      return;
    }
    capture.current = microphone;
    run.current = new ReplyRun(turn.seconds);
    startedAt.current = Date.now();
    voicedAt.current = Date.now();
    setPhase("replying");
  }, [phase, turn.seconds]);

  /** The reply's one timer. Nothing in it reaches a network. */
  useEffect(() => {
    if (phase !== "replying") return;
    const timer = setInterval(() => {
      const engine = run.current;
      if (!engine) return;
      const elapsedMs = Date.now() - startedAt.current;
      const state = engine.advanceTo({ elapsedMs, voiced: Date.now() - voicedAt.current < 400 });
      setRemainingMs(state.remainingMs);
      if (state.nudge) {
        setNudgeLine(state.nudge);
        setAnnouncement(state.nudge);
        nudgeShownAt.current = elapsedMs;
      } else if (nudgeShownAt.current !== null && elapsedMs - nudgeShownAt.current >= NUDGE_LIFETIME_MS) {
        nudgeShownAt.current = null;
        setNudgeLine(null);
      }
      if (state.over) void endReply(false);
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [endReply, phase]);

  /** A tab closed mid-round ends the interview by beacon, which the browser
   *  delivers after the page is gone. */
  const saveByBeacon = useCallback(() => {
    if (ending.current || (phase !== "listening" && phase !== "replying")) return;
    ending.current = true;
    const replyMs = startedAt.current ? Date.now() - startedAt.current : 0;
    navigator.sendBeacon?.(
      `/api/voice/sessions/${sessionId}/turns/${turn.turn}/finish`,
      new Blob([JSON.stringify({ ...said(), replyMs, close: true })], { type: "application/json" }),
    );
  }, [phase, said, sessionId, turn.turn]);

  useEffect(() => {
    window.addEventListener("pagehide", saveByBeacon);
    return () => window.removeEventListener("pagehide", saveByBeacon);
  }, [saveByBeacon]);

  useEffect(() => () => {
    void capture.current?.stop();
    capture.current = null;
    socket.current?.close();
    socket.current = null;
  }, []);

  const saveAgain = useCallback(async () => {
    const waiting = pending.current;
    if (!waiting) return;
    await store(waiting.ordinal, waiting.reply, waiting.leave);
  }, [store]);

  const debrief = `/voice/sessions/${sessionId}` as Route;

  if (phase === "unsaved") {
    // Nothing here leaves the page: the reply exists only in this tab.
    return (
      <div className="mt-8 border border-border bg-surface p-6" role="alert">
        <h2 className="font-medium">Your reply did not save.</h2>
        <p className="mt-2 text-text-dim">{unsaved}</p>
        <button type="button" onClick={() => void saveAgain()}
                className="mt-4 rounded border border-accent px-3 py-1.5 text-accent hover:bg-surface-2">
          Save again
        </button>
      </div>
    );
  }

  if (phase === "closed") {
    return (
      <div className="mt-8 border border-border bg-surface p-6">
        <h2 className="font-medium">Interview finished.</h2>
        <p className="mt-2 text-text-dim">
          Scoring runs next and takes a moment. The debrief shows every question you were asked and
          what you said back.
        </p>
        <div className="mt-4 flex flex-wrap gap-2.5">
          <Link href={debrief}
                className="inline-block rounded border border-accent px-3 py-1.5 text-accent hover:bg-surface-2">
            Open the debrief
          </Link>
          {nextHref ? (
            <Link href={nextHref}
                  className="inline-block rounded border border-border px-3 py-1.5 text-text-dim hover:text-text">
              Next question
            </Link>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="results-pane mt-6">
      <header className="flex items-baseline justify-between border-b border-border pb-3">
        <h1 className="text-lg font-semibold">{title}</h1>
        <span className="tnum text-lg font-mono">
          {clock(phase === "replying" ? remainingMs : turn.seconds * 1000)}
        </span>
      </header>

      {phase === "waiting" ? (
        <section aria-label="Between rounds" className="mt-10 space-y-6">
          <p className="text-text-dim">{asker} is thinking.</p>
          <MicLevel rms={0} live={false} />
        </section>
      ) : null}

      {phase === "listening" ? (
        <section aria-label="The interviewer" className="mt-10 space-y-5">
          <p className="text-text-dim">
            Round {turn.turn} of {turn.rounds}. {turn.interviewer.name}, {turn.interviewer.title}.
          </p>
          {phase === "listening" && turn.audioUrl === null ? (
            <p className="text-lg">{turn.text}</p>
          ) : null}
          {turn.audioUrl ? (
            <audio key={`${turn.turn}:${heard}`} autoPlay src={turn.audioUrl}
                   aria-label={`${turn.interviewer.name} speaking`}
                   onEnded={() => void startReply()}
                   onError={() => setProblem("The interviewer could not be played. Press Hear it again, " +
                                             "or Stop and debrief: the debrief shows every question.")} />
          ) : (
            <p className="text-text-faint">No spoken audio is configured, so the question is written. Answer it out loud.</p>
          )}
          <div className="flex flex-wrap gap-2.5">
            {turn.audioUrl ? (
              <button type="button" onClick={() => setHeard((count) => count + 1)}
                      className="rounded border border-border px-3 py-1.5 text-text-dim hover:text-text">
                Hear it again
              </button>
            ) : null}
            <button type="button" onClick={() => void startReply()}
                    className="rounded border border-accent px-3 py-1.5 text-accent hover:bg-surface-2">
              Answer now
            </button>
          </div>
        </section>
      ) : null}

      {phase === "replying" ? (
        <section aria-label="Your reply" className="mt-10 space-y-8">
          <MicLevel rms={rms} live />
          <NudgeSlot line={nudgeLine} />
          <button type="button" onClick={() => void endReply(false)}
                  className="rounded border border-accent px-3 py-1.5 text-accent hover:bg-surface-2">
            Done answering
          </button>
        </section>
      ) : null}

      {problem && phase !== "waiting" ? <p className="mt-6 text-warn" role="alert">{problem}</p> : null}
      {note && phase !== "replying" ? <p className="mt-6 text-text-dim">{note}</p> : null}

      {phase === "listening" || phase === "replying" ? (
        <div className="mt-10 flex justify-end gap-2.5">
          {nextHref ? (
            <button type="button" onClick={() => void endReply(true, true)}
                    className="rounded border border-border px-3 py-1.5 text-text-dim hover:text-text">
              Next question
            </button>
          ) : null}
          <button type="button" onClick={() => void endReply(true)}
                  className="rounded border border-border px-3 py-1.5 text-text-dim hover:text-text">
            Stop and debrief
          </button>
        </div>
      ) : null}

      <Announcer message={announcement} />
    </div>
  );
}
