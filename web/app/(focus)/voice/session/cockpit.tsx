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
 *
 * The third: a failure is said, never swallowed. Opening, saving and storing
 * the recording go through lib/voice/save.ts, which returns a result with the
 * learner's sentence in it. An answer that did not save is never shown as
 * recorded: it stays in this tab with Save again until the server has it.
 *
 * A typed answer lives in typed-answer.tsx and never here, because a text box
 * is the learner's words on screen and this file exists to keep them off it.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { encodePcm, startCapture, type Capture } from "@/lib/voice/capture";
import { runMicCheck } from "@/lib/voice/mic-check.browser";
import { CHECK_SECONDS, type MicVerdict } from "@/lib/voice/mic-check";
import type { CloseReason, ServerMessage } from "@/lib/voice/protocol";
import { currentBeat, initialState, territory, type BeatState } from "@/lib/voice/cues";
import { CockpitRun, type VoiceMode } from "@/lib/voice/run";
import type { FollowUp, VoiceQuestion } from "@/lib/voice/question";
import {
  openSession, saveAnswer, socketLostNote, uploadRecording, type Answer, type Fetcher,
} from "@/lib/voice/save";
import type { TurnView } from "@/lib/voice/turns";
import { ResumeBox } from "@/components/voice/resume-box";
import { Announcer, BeatTrack, MicLevel, NudgeSlot, PaceBand, Territory } from "./instruments";
import { Interview } from "./interview";
import { clock } from "@/lib/voice/clock";

/** fetch, called as a plain function so it is never invoked on another object. */
const send: Fetcher = (url, init) => fetch(url, init);

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

/**
 * How long Stop waits for the socket to say it has drained. The transcriber
 * holds the last second or two of speech until its stream closes, and the
 * socket sends those words and then "closed". Saving before that dropped the
 * end of every answer, which is where the close lands. Past this the
 * cockpit saves what it has, with any words still in flight kept as they
 * were last heard.
 */
const CLOSE_WAIT_MS = 1_500;

/** How long Stop waits for the microphone to hand over its recording. A
 *  recorder that never reports it stopped would otherwise hold the save, and
 *  the answer matters more than its playback copy. */
const STOP_WAIT_MS = 2_000;

/** docs/07 section 7 asks for the check "before the first session and before
 *  any Pressure run". Inside this window a passed check carries over to the
 *  next question, so Next question does not cost five seconds of silence. */
const MIC_CHECK_KEEPS_MS = 30 * 60_000;
const MIC_CHECK_KEY = "voice-mic-checked-at";

function recentMicCheck(): boolean {
  try {
    const at = Number(window.sessionStorage.getItem(MIC_CHECK_KEY));
    return Number.isFinite(at) && at > 0 && Date.now() - at < MIC_CHECK_KEEPS_MS;
  } catch {
    return false;
  }
}

function rememberMicCheck(): void {
  try {
    window.sessionStorage.setItem(MIC_CHECK_KEY, String(Date.now()));
  } catch {
    // Storage refused, so the next question asks for the check again.
  }
}

type Phase = "idle" | "checking" | "ready" | "live" | "closing" | "done";

type Interruption = { followUp: FollowUp; firedAtMs: number; endsAt: number };

/** Joins segments into the running text the cue engine matches against and
 *  the judge scores. Never rendered; see the rule this file is built around. */
function spoken(segments: { text: string }[]): string {
  return segments.map((segment) => segment.text).join(" ");
}

export function Cockpit({ question, mode, nextSlug, lobby, interviewer = null, carry = {} }: {
  question: VoiceQuestion;
  mode: VoiceMode;
  /** The picker's next question, or null when this is the only one. */
  nextSlug: string | null;
  /** The mode links and the typed-answer link. Drawn before and after an
   *  answer and never during one. */
  lobby?: ReactNode;
  /** Who asks, as the lobby resolved it. The session route resolves the slug
   *  again; the name is for the interruption's one line. */
  interviewer?: { slug: string; name: string } | null;
  /** The lobby's query to keep on Next question and the typed answer: the
   *  chosen interviewer and the picker's track. */
  carry?: Record<string, string>;
}) {
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>("idle");
  const [verdict, setVerdict] = useState<MicVerdict | null>(null);
  /** A check passed on an earlier question inside the last half hour. */
  const [carried, setCarried] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const [elapsedMs, setElapsedMs] = useState(0);
  const [beatState, setBeatState] = useState<BeatState>(() => initialState(question.beats));
  const [nudgeLine, setNudgeLine] = useState<string | null>(null);
  const nudgeShownAt = useRef<number | null>(null);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const [rms, setRms] = useState(0);
  const [interruption, setInterruption] = useState<Interruption | null>(null);
  const [finishedId, setFinishedId] = useState<number | null>(null);
  /** The microphone, the socket or the transcriber failed mid-answer, so the
   *  cockpit offers the typed answer. */
  const [failed, setFailed] = useState(false);
  /** Start was pressed and the server has not answered yet. A second press
   *  would open a second session and claim a second unit of the allowance. */
  const [starting, setStarting] = useState(false);
  /** Why the answer did not save, while it waits in this tab for Save again. */
  const [unsaved, setUnsaved] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  /** Interview mode: the first follow-up round, once the main answer is
   *  saved, which hands the screen over to interview.tsx. */
  const [handover, setHandover] = useState<TurnView | null>(null);
  /** Interview mode: a pasted resume, held until Start sends it once. */
  const [resume, setResume] = useState("");
  /** Interview mode: a sentence from the opening, shown between rounds. */
  const [openingNote, setOpeningNote] = useState<string | null>(null);

  /**
   * Transcript text lives here and only here.
   *
   * A ref is not a rendering surface, so nothing on screen can read it by
   * accident. The cue engine takes it as an argument and returns beats and
   * nudges; the transcript itself goes to the server at the end and to the
   * debrief in Phase 7c, where the learner is no longer speaking.
   */
  const transcript = useRef({
    partial: "",
    // Segments rather than strings: the delivery metrics in docs/07 section 6
    // need the gaps between them, and a joined string has no gaps in it.
    finals: [] as { text: string; startMs: number; endMs: number }[],
  });

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
  /** Resolves the wait in finish() when the socket says it has drained. */
  const drained = useRef<(() => void) | null>(null);
  /** Set once finish() has begun, so a second Stop, the unmount and the
   *  closing tab cannot each try to close the same session. */
  const finishing = useRef(false);
  /** Set when the answer starts. Before that, a failure is the platform's
   *  and the session is closed at once, which hands its allowance back. */
  const answering = useRef(false);
  /** Set while Start waits on the server, before React has re-rendered the
   *  button as disabled, so a double click opens one session. */
  const opening = useRef(false);
  /** The reason the socket gave in its last "closed" message, so a close
   *  mid-answer can say what happened rather than only that it did. */
  const closeReason = useRef<CloseReason | null>(null);
  /** An answer the server has not taken yet, kept for Save again. */
  const pending = useRef<{ id: number; answer: Answer; recording: Blob | null } | null>(null);

  // Interview mode's main answer is a guided answer; its rounds come after.
  const guided = mode === "guided" || mode === "pressure" || mode === "interview";
  const spokenOnly = mode === "pressure" || mode === "interview";
  const typedHref = {
    pathname: "/voice/session",
    query: { q: question.slug, mode: spokenOnly ? "guided" : mode, input: "typed", ...carry },
  } as const;
  const nextHref = nextSlug
    ? { pathname: "/voice/session", query: { q: nextSlug, mode, ...carry } } as const : null;
  /** The same two addresses as strings, for router.push once the answer is saved. */
  const address = (query: Record<string, string>) =>
    `/voice/session?${new URLSearchParams(query).toString()}` as Route;

  // A check passed on the last question carries over, except into pressure.
  useEffect(() => {
    // Pressure and interview get their own check: both are a conversation
    // out loud, and a muted microphone loses the rounds too.
    if (!spokenOnly && recentMicCheck()) {
      setCarried(true);
      setPhase("ready");
    }
  }, [spokenOnly]);

  const check = useCallback(async () => {
    setPhase("checking");
    setNote(null);
    const result = await runMicCheck(({ rms: level }) => setRms(level));
    setRms(0);
    setVerdict(result);
    if (result.ok) rememberMicCheck();
    setPhase(result.ok ? "ready" : "idle");
  }, []);

  /** The answer's own clock: wall time since the start, less every moment
   *  spent inside an interruption. docs/07 section 5 wants the remaining time
   *  unchanged after one. */
  const answerClock = useCallback(() => {
    const paused = pausedFrom.current === null ? 0 : Date.now() - pausedFrom.current;
    return Date.now() - startedAt.current - pausedMs.current - paused;
  }, []);

  /**
   * Save the answer, then its recording. On a failure the answer stays in
   * this tab for Save again, and the cockpit says why rather than showing it
   * as recorded. Returns whether the server has it.
   */
  const persist = useCallback(async (id: number, answer: Answer, recording: Blob | null) => {
    const result = await saveAnswer(send, id, answer);
    if (!result.saved) {
      pending.current = { id, answer, recording };
      setUnsaved(result.message);
      return false;
    }
    // Cleared only now. Cleared before the request, the screen read "Answer
    // recorded" while Save again was still waiting on the server.
    pending.current = null;
    setUnsaved(null);
    setFinishedId(id);
    // Interview mode: the reply carries round 1, and the rounds take over.
    if (result.turn) setHandover(result.turn);

    // docs/07 section 7: the MediaRecorder copy is kept for playback and
    // written to storage at the end. It is not the PCM the transcriber
    // heard; the two copies exist for different jobs and only this one is
    // stored. With no bucket configured the request answers that nothing
    // was stored, and the debrief replays on its own clock instead.
    if (recording && recording.size > 0) {
      const upload = await uploadRecording(send, id, recording);
      if (upload.message) setNote(upload.message);
    }
    return true;
  }, []);

  const saveAgain = useCallback(async () => {
    const waiting = pending.current;
    if (!waiting) return;
    setRetrying(true);
    await persist(waiting.id, waiting.answer, waiting.recording);
    setRetrying(false);
    router.refresh();
  }, [persist, router]);

  const finish = useCallback(async (): Promise<boolean> => {
    if (finishing.current) return false;
    finishing.current = true;
    const cockpit = run.current;
    // The microphone first, so no frame follows the stop. A recorder that
    // never says it stopped, or throws, costs the playback copy and never
    // the answer.
    let recording: Blob | null = null;
    try {
      recording = await Promise.race([
        capture.current?.stop() ?? Promise.resolve(null),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), STOP_WAIT_MS)),
      ]);
    } catch {
      recording = null;
    }
    capture.current = null;

    const ws = socket.current;
    socket.current = null;
    if (ws && ws.readyState === WebSocket.OPEN) {
      const heard = new Promise<void>((resolve) => { drained.current = resolve; });
      ws.send(JSON.stringify({ t: "stop" }));
      await Promise.race([heard, new Promise((resolve) => setTimeout(resolve, CLOSE_WAIT_MS))]);
      drained.current = null;
    }
    ws?.close();

    // Words the transcriber had not settled when the wait ran out. They were
    // spoken, so they are kept rather than dropped.
    const { partial } = transcript.current;
    if (partial.trim()) {
      const at = answerClock();
      transcript.current.finals.push({ text: partial.trim(), startMs: at, endMs: at });
      transcript.current.partial = "";
    }

    // A note from the answer, such as the socket dropping, told the learner
    // to press Stop. They have, so it goes; the save writes its own.
    setNote(null);
    let saved = true;
    if (cockpit && sessionId.current !== null) {
      const timeline = cockpit.timeline();
      saved = await persist(sessionId.current, {
        transcript: spoken(transcript.current.finals),
        segments: transcript.current.finals,
        timeline: { ...timeline, interruptions: interruptions.current },
      }, recording);
    }
    setPhase("done");
    router.refresh();
    return saved;
  }, [answerClock, persist, router]);

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
        partialTranscript: `${spoken(transcript.current.finals)} ${transcript.current.partial}`,
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
  /**
   * The socket or the microphone failed after Start and before the answer
   * began. The session row exists and holds an allowance, so it is closed
   * here with nothing said, which docs/07 section 10 gives back.
   */
  const abandon = useCallback(() => {
    const id = sessionId.current;
    sessionId.current = null;
    run.current = null;
    socket.current?.close();
    socket.current = null;
    if (id === null || finishing.current) return;
    finishing.current = true;
    // Tried again like any save, since a close that never lands keeps the
    // allowance it claimed.
    void saveAnswer(send, id, { transcript: "", segments: [], timeline: { beats: [], nudges: [] } });
  }, []);

  const saveByBeacon = useCallback(() => {
    const cockpit = run.current;
    if (!cockpit || sessionId.current === null || finishing.current) return;
    finishing.current = true;
    const body = JSON.stringify({
      transcript: spoken(transcript.current.finals),
      segments: transcript.current.finals,
      timeline: { ...cockpit.timeline(), interruptions: interruptions.current },
    });
    navigator.sendBeacon?.(
      `/api/voice/sessions/${sessionId.current}/finish`,
      new Blob([body], { type: "application/json" }),
    );
  }, []);

  useEffect(() => {
    if (phase !== "live") return;
    // pagehide fires on a closed tab and on a back navigation, where
    // beforeunload is unreliable on mobile Safari.
    window.addEventListener("pagehide", saveByBeacon);
    return () => window.removeEventListener("pagehide", saveByBeacon);
  }, [phase, saveByBeacon]);

  /**
   * A link followed mid-answer, such as the header or the picker. That is a
   * navigation inside the application, which fires no pagehide, so the
   * cockpit unmounts with the microphone and the socket still open. Close
   * both and save what was heard.
   */
  useEffect(() => () => {
    saveByBeacon();
    void capture.current?.stop();
    capture.current = null;
    socket.current?.close();
    socket.current = null;
  }, [saveByBeacon]);

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
    if (opening.current) return;
    opening.current = true;
    setStarting(true);
    setNote(null);
    setFailed(false);
    // Interview mode may carry a pasted resume, sent this once.
    const pasted = mode === "interview" && resume.trim() ? { resume } : {};
    let opened: Awaited<ReturnType<typeof openSession>>;
    try {
      opened = await openSession(send, { mode, question: question.slug, interviewer: interviewer?.slug, ...pasted });
    } finally {
      opening.current = false;
      setStarting(false);
    }
    if (!opened.ok) {
      setNote(opened.message);
      return;
    }
    const started = opened.started;
    setResume("");
    setOpeningNote(started.interview?.resumeNote ?? null);

    // A fresh attempt. A start whose socket failed earlier on this page left
    // these set, and a stale finishing flag made the next Stop do nothing.
    finishing.current = false;
    answering.current = false;
    closeReason.current = null;
    transcript.current.partial = "";
    transcript.current.finals = [];
    seq.current = 0;
    sessionId.current = started.sessionId;
    run.current = new CockpitRun(question.beats, question.totalSeconds, guided);

    let ws: WebSocket;
    try {
      ws = new WebSocket(`${started.socketUrl}?token=${encodeURIComponent(started.token)}`);
    } catch {
      setNote("This server's voice socket address is not one a browser can open, so the answer " +
              "did not start and nothing was counted. Type the answer instead, and tell an admin.");
      setFailed(true);
      abandon();
      return;
    }
    socket.current = ws;

    ws.onmessage = (event) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(event.data as string) as ServerMessage;
      } catch {
        // Not the protocol, so there is nothing in it to act on.
        return;
      }
      // Both branches write to a ref. Neither reaches state, and nothing on
      // screen can read a ref.
      if (message.t === "partial") transcript.current.partial = message.text;
      else if (message.t === "final") {
        transcript.current.finals.push({
          text: message.text, startMs: message.startMs, endMs: message.endMs,
        });
        transcript.current.partial = "";
      } else if (message.t === "closed") {
        closeReason.current = message.reason;
        drained.current?.();
      } else if (message.t === "error") {
        if (!answering.current) {
          // Refused or broken before the answer began, such as a token the
          // socket will not accept or a transcriber that would not open.
          // That is the platform's failure, so the session closes now and
          // costs nothing, and the admin gets the socket's own words.
          setNote("The voice socket could not take this answer, so it did not start and nothing " +
                  `was counted. Type the answer instead, and tell an admin it said: ${message.message}`);
          setFailed(true);
          abandon();
        } else {
          // Mid-answer the socket's own words are the accurate ones: behind
          // API Gateway one failed batch loses its words and the next batch
          // tries again, and the socket says so.
          setNote(message.message);
          if (message.code === "stt_failed") setFailed(true);
        }
      }
    };
    ws.onerror = () => {
      setNote(answering.current
        ? "The voice socket failed, so your answer is not being transcribed."
        : "The voice socket did not connect, so the answer did not start and nothing was counted.");
      setFailed(true);
      if (!answering.current) abandon();
    };
    ws.onclose = (event) => {
      if (!answering.current) {
        abandon();
        return;
      }
      // Closed by the server or the network while the learner was still
      // answering. Nothing said from here on is heard, so the cockpit says so
      // at once rather than letting them talk into a closed socket. 1011 is
      // the socket closing because its transcriber failed.
      if (!finishing.current) {
        const reason = closeReason.current ?? (event.code === 1011 ? "failed" : null);
        setNote(socketLostNote(reason, answerClock()));
        setFailed(true);
      }
    };

    ws.onopen = async () => {
      let microphone: Capture;
      try {
        microphone = await startCapture({
          record: true,
          onFrame: ({ pcm, rms: level }) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ t: "audio", seq: seq.current++, pcm: encodePcm(pcm) }));
            }
            setRms(level);
            if (level >= VOICED_RMS) voicedAt.current = Date.now();
          },
        });
      } catch {
        setNote("The microphone could not be opened, so nothing was counted. Check the " +
                "browser's permission for this site.");
        setFailed(true);
        abandon();
        return;
      }
      // The socket can refuse the session while the microphone opens, and
      // the session is closed by then. Starting the clock anyway left a live
      // cockpit with nothing behind it and a Stop that never finished.
      if (ws.readyState !== WebSocket.OPEN || sessionId.current !== started.sessionId) {
        void microphone.stop().catch(() => null);
        return;
      }
      capture.current = microphone;
      answering.current = true;
      startedAt.current = Date.now();
      voicedAt.current = Date.now();
      setPhase("live");
    };
  }, [abandon, answerClock, guided, interviewer?.slug, mode, question.beats, question.slug, resume,
      question.totalSeconds]);

  const remainingMs = question.totalSeconds * 1000 - elapsedMs;
  // Once every beat is covered there is no current beat, and showing the
  // band's "never reached" state then would say the opposite of what
  // happened. The learner is still speaking and still on the last beat they
  // landed, so that is what the band keeps showing.
  const beat = currentBeat(beatState) ?? beatState.beats.at(-1) ?? null;
  const live = phase === "live" || phase === "closing";

  if (phase === "done" && unsaved) {
    // No lobby and no Next question here: both leave the page, and the answer
    // exists only in this tab until Save again lands.
    return (
      <div className="mt-8 border border-border bg-surface p-6" role="alert">
        <h2 className="font-medium">Your answer did not save.</h2>
        <p className="mt-2 text-text-dim">{unsaved}</p>
        <div className="mt-4 flex flex-wrap gap-2.5">
          <button
            type="button"
            onClick={() => void saveAgain()}
            disabled={retrying}
            className="inline-block rounded border border-accent px-3 py-1.5 text-accent
                       hover:bg-surface-2 disabled:opacity-50"
          >
            {retrying ? "Saving" : "Save again"}
          </button>
          <Link href={typedHref}
                className="inline-block rounded border border-border px-3 py-1.5 text-text-dim hover:text-text">
            Type the answer instead
          </Link>
        </div>
      </div>
    );
  }

  if (phase === "done" && handover && finishedId !== null) {
    // Interview mode: the main answer is saved and round 1 is ready. No
    // lobby here, because a round is part of the answer.
    return (
      <Interview sessionId={finishedId} first={handover} title={question.title}
                 asker={interviewer?.name ?? "The interviewer"} nextHref={nextHref} note={openingNote} />
    );
  }

  if (phase === "done") {
    return (
      <>
      {lobby}
      <div className="mt-8 border border-border bg-surface p-6">
        <h2 className="font-medium">Answer recorded.</h2>
        <p className="mt-2 text-text-dim">
          Scoring runs next and takes a moment. The debrief replays your answer with the
          instruments turned on.
        </p>
        <div className="mt-4 flex flex-wrap gap-2.5">
          {finishedId !== null && (
            <Link
              href={`/voice/sessions/${finishedId}` as Route}
              className="inline-block rounded border border-accent px-3 py-1.5 text-accent
                         hover:bg-surface-2"
            >
              Open the debrief
            </Link>
          )}
          {nextHref && (
            <Link href={nextHref}
                  className="inline-block rounded border border-border px-3 py-1.5 text-text-dim hover:text-text">
              Next question
            </Link>
          )}
        </div>
        {note && <p className="mt-3 text-warn">{note}</p>}
      </div>
      </>
    );
  }

  if (!live) {
    return (
      <>
      {lobby}
      <div className="mt-8 space-y-6">
        {/* The question, read before the answer starts. Guided and pressure
            never showed it, so a learner answered a title. */}
        <section aria-label="The question" className="border-l-2 border-border-strong pl-4">
          <p className="whitespace-pre-line text-lg leading-relaxed">{question.promptText}</p>
        </section>

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
          {carried && !verdict && (
            <p className="mt-3 text-text-dim">
              Checked on an earlier question in the last half hour. Run it again if anything changed.
            </p>
          )}
          {verdict && (
            <p className={`mt-3 ${verdict.ok ? "text-pass" : "text-fail"}`}>
              {verdict.ok ? "Heard you. You are ready." : verdict.message}
            </p>
          )}
          {(failed || (verdict && !verdict.ok)) && (
            <p className="mt-2 text-text-dim">
              If the microphone will not work here,{" "}
              <Link href={typedHref} className="text-text underline underline-offset-2">
                type the answer instead
              </Link>
              .
            </p>
          )}
        </section>

        {mode === "interview" ? <ResumeBox value={resume} onChange={setResume} /> : null}

        <button
          type="button"
          onClick={() => void start()}
          disabled={starting || (!verdict?.ok && !(carried && !verdict))}
          className="rounded border border-accent px-4 py-2 text-accent hover:bg-surface
                     disabled:opacity-50"
        >
          {starting ? "Opening" : "Start the answer"}
        </button>
        {!verdict?.ok && !(carried && !verdict) && (
          <p className="text-text-faint">
            The check has to pass first. Finding out at 0:40 that you were muted costs you the
            attempt.
          </p>
        )}
        {note && <p className="text-warn">{note}</p>}
      </div>
      </>
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
          <p className="font-mono text-text-faint">
            {interviewer ? `${interviewer.name} cuts in` : "the interviewer cuts in"}
          </p>
          <p className="text-lg">{interruption.followUp.text}</p>
          {interruption.followUp.audioUrl ? (
            // In the chosen interviewer's voice: the address resolves the
            // slug to a voice on the server.
            <audio autoPlay aria-label="The interviewer speaking"
                   src={interviewer
                     ? `${interruption.followUp.audioUrl}?interviewer=${encodeURIComponent(interviewer.slug)}`
                     : interruption.followUp.audioUrl} />
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

      {failed && (
        // An alert, so a learner who cannot see it still hears that nothing
        // more is being heard. The announcer stays for beats and nudges.
        <div className="mt-8 border border-border bg-surface p-4" role="alert">
          <p className={note ? "text-warn" : "text-text-dim"}>
            {note ?? "What you said so far is kept. You can stop here and type the answer instead."}
          </p>
          <button
            type="button"
            onClick={() => {
              setPhase("closing");
              void finish().then(() => router.push(address(typedHref.query)));
            }}
            disabled={phase === "closing"}
            className="mt-3 rounded border border-border px-3 py-1.5 text-text-dim hover:text-text
                       disabled:opacity-50"
          >
            Stop and type it
          </button>
        </div>
      )}

      <div className="mt-10 flex justify-end gap-2.5">
        {nextHref && (
          <button
            type="button"
            onClick={() => {
              setPhase("closing");
              // Only once the answer is saved: leaving with it unsaved loses it.
              void finish().then((saved) => {
                if (saved && nextHref) router.push(address(nextHref.query));
              });
            }}
            disabled={phase === "closing"}
            className="rounded border border-border px-3 py-1.5 text-text-dim hover:text-text
                       disabled:opacity-50"
          >
            Next question
          </button>
        )}
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
      {/* A failure's note sits in the panel above, beside its button. */}
      {note && !failed && <p className="mt-4 text-warn" role="alert">{note}</p>}
    </div>
  );
}
