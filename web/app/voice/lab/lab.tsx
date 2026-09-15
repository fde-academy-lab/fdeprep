"use client";

/**
 * The browser end of the transport check.
 *
 * Deliberately screenless about content: partials and finals go to
 * console.log and nothing else. docs/07 section 3 calls no live transcript
 * the single most important rule in the module and the most likely one to get
 * built wrong by default, so the first page that could break it does not.
 * What renders here are counters, which say whether the pipeline is moving
 * without saying a word of what was said.
 */
import { useCallback, useRef, useState } from "react";
import { encodePcm, startCapture, type Capture } from "@/lib/voice/capture";
import { runMicCheck } from "@/lib/voice/mic-check.browser";
import { CHECK_SECONDS, type MicVerdict } from "@/lib/voice/mic-check";
import type { ServerMessage } from "@/lib/voice/protocol";

type Counters = {
  frames: number;
  bytes: number;
  partials: number;
  finals: number;
  errors: number;
};

const ZERO: Counters = { frames: 0, bytes: 0, partials: 0, finals: 0, errors: 0 };

type Phase = "idle" | "checking" | "ready" | "connecting" | "streaming" | "closed";

export function VoiceLab() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [verdict, setVerdict] = useState<MicVerdict | null>(null);
  const [level, setLevel] = useState(0);
  const [counters, setCounters] = useState<Counters>(ZERO);
  const [note, setNote] = useState<string | null>(null);
  const [contextRate, setContextRate] = useState<number | null>(null);

  const socket = useRef<WebSocket | null>(null);
  const capture = useRef<Capture | null>(null);
  const seq = useRef(0);

  const check = useCallback(async () => {
    setPhase("checking");
    setNote(null);
    setVerdict(null);
    const result = await runMicCheck(({ rms }) => setLevel(rms));
    setLevel(0);
    setVerdict(result);
    setPhase(result.ok ? "ready" : "idle");
  }, []);

  const teardown = useCallback(async () => {
    socket.current?.close();
    socket.current = null;
    const recording = await capture.current?.stop();
    capture.current = null;
    if (recording) {
      console.log(
        `[voice] MediaRecorder copy: ${recording.size} bytes of ${recording.type}. ` +
          "Phase 7c writes this to S3.",
      );
    }
  }, []);

  const start = useCallback(async () => {
    setPhase("connecting");
    setNote(null);
    setCounters(ZERO);
    seq.current = 0;

    const response = await fetch("/api/voice/lab", { method: "POST" });
    if (!response.ok) {
      const body = (await response.json()) as { message?: string };
      setNote(body.message ?? "The session could not be opened.");
      setPhase("idle");
      return;
    }
    const started = (await response.json()) as { token: string; socketUrl: string };

    const ws = new WebSocket(`${started.socketUrl}?token=${encodeURIComponent(started.token)}`);
    socket.current = ws;

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data as string) as ServerMessage;
      switch (message.t) {
        case "ready":
          console.log(`[voice] ready, session ${message.sessionId} at ${message.sampleRate}Hz`);
          break;
        case "partial":
          console.log(`[voice] partial @${message.startMs}ms: ${message.text}`);
          setCounters((c) => ({ ...c, partials: c.partials + 1 }));
          break;
        case "final":
          console.log(
            `[voice] final @${message.startMs}-${message.endMs}ms: ${message.text}`,
          );
          setCounters((c) => ({ ...c, finals: c.finals + 1 }));
          break;
        case "error":
          console.warn(`[voice] error ${message.code}: ${message.message}`);
          setNote(message.message);
          setCounters((c) => ({ ...c, errors: c.errors + 1 }));
          break;
        case "closed":
          console.log(
            `[voice] closed (${message.reason}) after ${message.frames} frames. ` +
              `transcript: ${JSON.stringify(message.transcript)}`,
          );
          setNote(`The socket closed: ${message.reason}.`);
          break;
      }
    };

    ws.onerror = () => setNote("The socket failed. Check that the voice endpoint is running.");
    ws.onclose = () => {
      setPhase("closed");
      void teardown();
    };

    ws.onopen = async () => {
      const live = await startCapture({
        record: true,
        onFrame: ({ pcm, rms }) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          const body = JSON.stringify({ t: "audio", seq: seq.current++, pcm: encodePcm(pcm) });
          ws.send(body);
          setLevel(rms);
          setCounters((c) => ({ ...c, frames: c.frames + 1, bytes: c.bytes + body.length }));
        },
      });
      capture.current = live;
      setContextRate(live.contextSampleRate);
      setPhase("streaming");
      console.log(
        `[voice] streaming. AudioContext at ${live.contextSampleRate}Hz, ` +
          "worklet delivering 16000Hz mono in 100ms frames.",
      );
    };
  }, [teardown]);

  const stop = useCallback(async () => {
    socket.current?.send(JSON.stringify({ t: "stop" }));
    await teardown();
    setPhase("closed");
    setLevel(0);
  }, [teardown]);

  const streaming = phase === "streaming";

  return (
    <div className="mt-6 space-y-6">
      <section className="border border-border bg-surface p-4">
        <div className="flex items-baseline justify-between">
          <h2 className="font-medium">1. Microphone check</h2>
          <span className="text-text-faint">{CHECK_SECONDS} seconds</span>
        </div>
        <button
          type="button"
          onClick={() => void check()}
          disabled={phase === "checking" || streaming}
          className="mt-3 rounded border border-accent px-3 py-1.5 text-accent
                     hover:bg-surface-2 disabled:opacity-50"
        >
          {phase === "checking" ? "Listening" : "Run the check"}
        </button>
        {verdict && (
          <p className={`mt-3 ${verdict.ok ? "text-pass" : "text-fail"}`}>
            {verdict.ok
              ? `Heard you. ${verdict.frames} frames, peak level ` +
                `${verdict.peakRms.toFixed(3)}.`
              : verdict.message}
          </p>
        )}
      </section>

      <section className="border border-border bg-surface p-4">
        <h2 className="font-medium">2. Stream to the socket</h2>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => void start()}
            disabled={!verdict?.ok || phase === "connecting" || streaming}
            className="rounded border border-accent px-3 py-1.5 text-accent
                       hover:bg-surface-2 disabled:opacity-50"
          >
            {phase === "connecting" ? "Connecting" : "Start streaming"}
          </button>
          <button
            type="button"
            onClick={() => void stop()}
            disabled={!streaming}
            className="rounded border border-border px-3 py-1.5 text-text-dim
                       hover:text-text disabled:opacity-50"
          >
            Stop
          </button>
        </div>
        {!verdict?.ok && (
          <p className="mt-3 text-text-faint">
            The microphone check has to pass first. A learner who finds out at 0:40 that they
            were muted has lost the attempt.
          </p>
        )}
      </section>

      <section className="results-pane border border-border bg-surface p-4">
        <h2 className="font-medium">Live counters</h2>
        <div className="mt-3 h-2 w-full bg-surface-2" aria-label="Microphone level">
          <div
            className="h-2 bg-accent"
            style={{ width: `${Math.min(100, Math.round(level * 400))}%` }}
          />
        </div>
        <table className="mt-4 w-full text-left tnum">
          <tbody className="divide-y divide-border">
            <Row label="Frames sent" value={counters.frames} />
            <Row label="Bytes sent" value={counters.bytes} />
            <Row label="Partials received" value={counters.partials} />
            <Row label="Finals received" value={counters.finals} />
            <Row label="Errors" value={counters.errors} />
            <Row label="AudioContext rate" value={contextRate ? `${contextRate} Hz` : "--"} />
          </tbody>
        </table>
        <p className="mt-3 text-text-faint">
          Transcripts print to the browser console. Nothing on this page shows them.
        </p>
      </section>

      {note && <p className="text-warn">{note}</p>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: number | string }) {
  return (
    <tr>
      <td className="py-1.5 text-text-dim">{label}</td>
      <td className="py-1.5 text-right">{value}</td>
    </tr>
  );
}
