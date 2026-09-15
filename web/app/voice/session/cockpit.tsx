"use client";

/**
 * The cockpit, in all three modes. docs/07 sections 3, 4 and 5.
 *
 * The rule this file is built around: no transcript text on screen during an
 * answer. That is enforced structurally rather than by care. Partial and
 * final text lands in a ref and never in state, so there is no variable React
 * can render it from, and the component would have to be edited to put it on
 * screen. A test reads this file and fails if any use of it escapes a ref.
 *
 * The second rule: no model call while the learner is speaking. Nothing here
 * fetches during an answer. The socket carries audio out and transcripts in,
 * the cue engine is substring matching, and the only fetches are one to open
 * the session and one to close it. A test asserts the count is zero across
 * the answer window.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { encodePcm, startCapture, type Capture } from "@/lib/voice/capture";
import { runMicCheck } from "@/lib/voice/mic-check.browser";
import { CHECK_SECONDS, type MicVerdict } from "@/lib/voice/mic-check";
import type { ServerMessage } from "@/lib/voice/protocol";
import { currentBeat, initialState, territory, type BeatState } from "@/lib/voice/cues";
import { CockpitRun, type VoiceMode } from "@/lib/voice/run";
import type { FollowUp, VoiceQuestion } from "@/lib/voice/question";
import { Announcer, BeatTrack, clock, MicLevel, NudgeSlot, PaceBand, Territory } from "./instruments";

/** docs/07 section 5: a sixty second clock for the interruption. */
const INTERRUPTION_SECONDS = 60;

/** docs/07 section 5: "Two interruptions maximum in one session." */
const MAX_INTERRUPTIONS = 2;

/** Above this the frame carried a voice rather than a room. Matches the floor
 *  the microphone check uses, so a learner who passed the check is heard. */
const VOICED_RMS = 0.01;

const TICK_MS = 100;

/**
 * How long a nudge stays in the slot.
 *
 * Not in docs/07, which says only that they never stack and never come
 * inside twenty seconds of each other. Watching one run showed why it needs
 * saying: a line that fires at 0:39 and is still there at 1:15 has stopped
 * being advice and become furniture, and by then it is usually wrong, because
 * the learner did the thing it asked. Eight seconds reads nine words several
 * times over and leaves the slot empty the rest of the time, which is what
 * makes the next line register as new.
 */
const NUDGE_LIFETIME_MS = 8_000;

type Phase = "idle" | "checking" | "ready" | "live" | "closing" | "done";

type Interruption = { followUp: FollowUp; firedAtMs: number; endsAt: number };

export function Cockpit({ question, mode }: { question: VoiceQuestion; mode: VoiceMode }) {
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>("idle");
  const [verdict, setVerdict] = useState<MicVerdict | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const [elapsedMs, setElapsedMs] = useState(0);
  const [beatState, setBeatState] = useState<BeatState>(() => initialState(question.beats));
  const [nudgeLine, setNudgeLine] = useState<string | null>(null);
  const nudgeShownAt = useRef<number | null>(null);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const [rms, setRms] = useState(0);
  const [interruption, setInterruption] = useState<Interruption | null>(null);

  /**
   * Transcript text lives here and only here.
   *
   * A ref is not a rendering surface, so nothing on screen can read it by
   * accident. The cue engine takes it as an argument and returns beats and
   * nudges; the transcript itself goes to the server at the end and to the
   * debrief in Phase 7c, where the learner is no longer speaking.
   */
  const transcript = useRef({ partial: "", finals: [] as string[] });

  const socket = useRef<WebSocket | null>(null);
  const capture = useRef<Capture | null>(null);
  const run = useRef<CockpitRun | null>(null);
  const seq = useRef(0);
  const voicedAt = useRef(0);
  const sessionId = useRef<number | null>(null);
  const startedAt = useRef(0);
  const pausedMs = useRef(0);
  const pausedFrom = useRef<number | null>(null);
  const firedFollowUps = useRef(new Set<number>());
  const interruptions = useRef<{ followUpId: number; firedAtMs: number; endedAtMs: number | null }[]>([]);

  const guided = mode === "guided" || mode === "pressure";

  const check = useCallback(async () => {
    setPhase("checking");
    setNote(null);
    const result = await runMicCheck(({ rms: level }) => setRms(level));
    setRms(0);
    setVerdict(result);
    setPhase(result.ok ? "ready" : "idle");
  }, []);

  /** The answer's own clock: wall time since the start, less every moment
   *  spent inside an interruption. docs/07 section 5 wants the remaining time
   *  unchanged after one. */
  const answerClock = useCallback(() => {
    const paused = pausedFrom.current === null ? 0 : Date.now() - pausedFrom.current;
    return Date.now() - startedAt.current - pausedMs.current - paused;
  }, []);

  const finish = useCallback(async () => {
    const cockpit = run.current;
    socket.current?.send(JSON.stringify({ t: "stop" }));
    socket.current?.close();
    socket.current = null;
    await capture.current?.stop();
    capture.current = null;

    if (cockpit && sessionId.current !== null) {
      const timeline = cockpit.timeline();
      await fetch(`/api/voice/sessions/${sessionId.current}/finish`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          transcript: transcript.current.finals.join(" "),
          timeline: { ...timeline, interruptions: interruptions.current },
        }),
      }).catch(() => setNote("The session ended but the debrief did not save. Tell an admin."));
    }
    setPhase("done");
    router.refresh();
  }, [router]);

  /** Pressure mode: at a beat boundary, the authored follow-up for the beat
   *  just covered fires, at most twice in a session. */
  const maybeInterrupt = useCallback(
    (state: BeatState, at: number) => {
      if (mode !== "pressure" || interruption) return;
      if (firedFollowUps.current.size >= MAX_INTERRUPTIONS) return;

      const covered = state.beats.filter((beat) => beat.covered).map((beat) => beat.key);
      const due = question.followUps.find(
        (followUp) =>
          covered.includes(followUp.triggerAfterBeat) && !firedFollowUps.current.has(followUp.id),
      );
      if (!due) return;

      firedFollowUps.current.add(due.id);
      pausedFrom.current = Date.now();
      interruptions.current.push({ followUpId: due.id, firedAtMs: at, endedAtMs: null });
      setInterruption({
        followUp: due,
        firedAtMs: at,
        endsAt: Date.now() + INTERRUPTION_SECONDS * 1000,
      });
      setAnnouncement(`Interruption. ${due.text}`);
    },
    [interruption, mode, question.followUps],
  );

  const endInterruption = useCallback(() => {
    if (pausedFrom.current !== null) {
      pausedMs.current += Date.now() - pausedFrom.current;
      pausedFrom.current = null;
    }
    const open = interruptions.current.at(-1);
    if (open && open.endedAtMs === null) open.endedAtMs = answerClock();
    setInterruption(null);
    setAnnouncement("Back to the answer.");
  }, [answerClock]);

  /** The one timer. Everything the cockpit shows is recomputed here. */
  useEffect(() => {
    if (phase !== "live") return;
    const timer = setInterval(() => {
      const cockpit = run.current;
      if (!cockpit) return;

      if (interruption) {
        if (Date.now() >= interruption.endsAt) endInterruption();
        return;
      }

      const at = answerClock();
      const nudge = cockpit.advanceTo({
        elapsedMs: at,
        partialTranscript: `${transcript.current.finals.join(" ")} ${transcript.current.partial}`,
        voiced: Date.now() - voicedAt.current < 400,
      });

      setElapsedMs(at);
      setBeatState(cockpit.beatState);
      if (nudge) {
        // One slot, one line: the newest replaces whatever was in it, and the
        // engine already refused to produce one inside twenty seconds.
        if (nudge.wasShown) {
          setNudgeLine(nudge.line);
          nudgeShownAt.current = at;
        }
        setAnnouncement(nudge.line);
      } else if (nudgeShownAt.current !== null && at - nudgeShownAt.current >= NUDGE_LIFETIME_MS) {
        nudgeShownAt.current = null;
        setNudgeLine(null);
      }
      maybeInterrupt(cockpit.beatState, at);

      if (at >= question.totalSeconds * 1000) {
        setPhase("closing");
        void finish();
      }
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [answerClock, endInterruption, finish, interruption, maybeInterrupt, phase, question.totalSeconds]);

  /**
   * A learner who closes the tab mid-answer.
   *
   * docs/07 section 12 item 9 wants an abandoned session to save what it
   * heard. A fetch during unload is cancelled, so this is sendBeacon, which
   * exists for exactly this and is delivered by the browser after the page is
   * gone. The socket closes by itself and the Phase 7a session core already
   * reports the partial transcript on its own side.
   */
  useEffect(() => {
    if (phase !== "live") return;
    const save = () => {
      const cockpit = run.current;
      if (!cockpit || sessionId.current === null) return;
      const body = JSON.stringify({
        transcript: transcript.current.finals.join(" "),
        timeline: { ...cockpit.timeline(), interruptions: interruptions.current },
      });
      navigator.sendBeacon?.(
        `/api/voice/sessions/${sessionId.current}/finish`,
        new Blob([body], { type: "application/json" }),
      );
    };
    // pagehide fires on a closed tab and on a back navigation, where
    // beforeunload is unreliable on mobile Safari.
    window.addEventListener("pagehide", save);
    return () => window.removeEventListener("pagehide", save);
  }, [phase]);

  /** Announce each beat as it becomes current, so the beat track has a voice. */
  const lastAnnouncedBeat = useRef<string | null>(null);
  useEffect(() => {
    const beat = currentBeat(beatState);
    const key = beat?.key ?? "done";
    if (key === lastAnnouncedBeat.current) return;
    lastAnnouncedBeat.current = key;
    if (phase === "live") {
      setAnnouncement(beat ? `Beat ${beat.key}. ${beat.label}.` : "Every beat covered.");
    }
  }, [beatState, phase]);

  const start = useCallback(async () => {
    setNote(null);
    const response = await fetch("/api/voice/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode }),
    });
    if (!response.ok) {
      const body = (await response.json()) as { message?: string };
      setNote(body.message ?? "The session could not be opened.");
      return;
    }
    const started = (await response.json()) as {
      sessionId: number; token: string; socketUrl: string;
    };
    sessionId.current = started.sessionId;
    run.current = new CockpitRun(question.beats, question.totalSeconds, guided);

    const ws = new WebSocket(`${started.socketUrl}?token=${encodeURIComponent(started.token)}`);
    socket.current = ws;

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data as string) as ServerMessage;
      // Both branches write to a ref. Neither reaches state, and nothing on
      // screen can read a ref.
      if (message.t === "partial") transcript.current.partial = message.text;
      else if (message.t === "final") {
        transcript.current.finals.push(message.text);
        transcript.current.partial = "";
      } else if (message.t === "error") setNote(message.message);
    };
    ws.onerror = () => setNote("The voice socket failed. Your answer is not being transcribed.");

    ws.onopen = async () => {
      capture.current = await startCapture({
        record: true,
        onFrame: ({ pcm, rms: level }) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ t: "audio", seq: seq.current++, pcm: encodePcm(pcm) }));
          }
          setRms(level);
          if (level >= VOICED_RMS) voicedAt.current = Date.now();
        },
      });
      startedAt.current = Date.now();
      voicedAt.current = Date.now();
      setPhase("live");
    };
  }, [guided, mode, question.beats, question.totalSeconds]);

  const remainingMs = question.totalSeconds * 1000 - elapsedMs;
  // Once every beat is covered there is no current beat, and showing the
  // band's "never reached" state then would say the opposite of what
  // happened. The learner is still speaking and still on the last beat they
  // landed, so that is what the band keeps showing.
  const beat = currentBeat(beatState) ?? beatState.beats.at(-1) ?? null;
  const live = phase === "live" || phase === "closing";

  if (phase === "done") {
    return (
      <div className="mt-8 border border-border bg-surface p-6">
        <h2 className="font-medium">Answer recorded.</h2>
        <p className="mt-2 text-text-dim">
          The debrief with your score arrives in the next release. Your audio, your transcript
          and every beat the cockpit lit are saved.
        </p>
        {note && <p className="mt-3 text-warn">{note}</p>}
      </div>
    );
  }

  if (!live) {
    return (
      <div className="mt-8 space-y-6">
        <section className="border border-border bg-surface p-4">
          <div className="flex items-baseline justify-between">
            <h2 className="font-medium">Microphone check</h2>
            <span className="text-text-faint">{CHECK_SECONDS} seconds</span>
          </div>
          <button
            type="button"
            onClick={() => void check()}
            disabled={phase === "checking"}
            className="mt-3 rounded border border-accent px-3 py-1.5 text-accent
                       hover:bg-surface-2 disabled:opacity-50"
          >
            {phase === "checking" ? "Listening" : "Run the check"}
          </button>
          {phase === "checking" && <MicLevel rms={rms} live />}
          {verdict && (
            <p className={`mt-3 ${verdict.ok ? "text-pass" : "text-fail"}`}>
              {verdict.ok ? "Heard you. You are ready." : verdict.message}
            </p>
          )}
        </section>

        <button
          type="button"
          onClick={() => void start()}
          disabled={!verdict?.ok}
          className="rounded border border-accent px-4 py-2 text-accent hover:bg-surface
                     disabled:opacity-50"
        >
          Start the answer
        </button>
        {!verdict?.ok && (
          <p className="text-text-faint">
            The check has to pass first. A learner who finds out at 0:40 that they were muted
            has lost the attempt.
          </p>
        )}
        {note && <p className="text-warn">{note}</p>}
      </div>
    );
  }

  return (
    <div className="results-pane mt-6">
      <header className="flex items-baseline justify-between border-b border-border pb-3">
        <h1 className="text-lg font-semibold">{question.title}</h1>
        <span className="tnum text-lg font-mono">{clock(remainingMs)}</span>
      </header>

      {interruption ? (
        <section className="mt-10 space-y-4" aria-label="Interruption">
          <p className="font-mono text-text-faint">the interviewer cuts in</p>
          <p className="text-lg">{interruption.followUp.text}</p>
          {interruption.followUp.audioUrl ? (
            <audio autoPlay src={interruption.followUp.audioUrl} aria-label="The interviewer speaking" />
          ) : (
            <p className="text-text-faint">
              No spoken audio is configured, so the follow-up is written. Answer it out loud.
            </p>
          )}
          <div className="flex items-baseline gap-4">
            <span className="tnum font-mono text-fail">
              {clock(Math.max(0, interruption.endsAt - Date.now()))}
            </span>
            <button
              type="button"
              onClick={endInterruption}
              className="rounded border border-border px-3 py-1.5 text-text-dim hover:text-text"
            >
              Done answering
            </button>
          </div>
          <p className="text-text-faint">
            The main clock is stopped. You get the same time back.
          </p>
        </section>
      ) : (
        <div className="mt-8 space-y-8">
          {guided ? (
            <>
              <BeatTrack beats={beatState.beats} currentIndex={beatState.currentIndex} />
              <PaceBand
                state={beat?.pace ?? "never_reached"}
                spentMs={beat?.spentMs ?? 0}
              />
              <Territory row={territory(beatState)} />
            </>
          ) : (
            <p className="text-text-dim">{question.promptText}</p>
          )}

          <MicLevel rms={rms} live />

          {guided ? (
            <NudgeSlot line={nudgeLine} />
          ) : (
            // docs/07 section 4: unguided has no nudge slot. Every nudge is
            // still computed and stored with was_shown false, which is what
            // makes the Phase 7c replay possible.
            <div className="h-6" />
          )}
        </div>
      )}

      <div className="mt-10 flex justify-end">
        <button
          type="button"
          onClick={() => {
            setPhase("closing");
            void finish();
          }}
          disabled={phase === "closing"}
          className="rounded border border-border px-3 py-1.5 text-text-dim hover:text-text
                     disabled:opacity-50"
        >
          {phase === "closing" ? "Saving" : "Stop and debrief"}
        </button>
      </div>

      <Announcer message={announcement} />
      {note && <p className="mt-4 text-warn">{note}</p>}
    </div>
  );
}
