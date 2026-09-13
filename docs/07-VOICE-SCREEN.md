# FDE Prep: Voice Screen

A spoken interview simulator. The learner hears or reads a question, answers out loud into a microphone under a clock, and gets a debrief that scores what they said and shows how they said it.

Three modes. Guided is an instrumented cockpit. Unguided is a microphone and a clock. Pressure adds an interviewer who interrupts.

---

## 1. Why this exists

FDE tech screens are spoken. A candidate who can write the agent loop and cannot say why they chose it fails the round. The code workspace already covers the first half. This covers the second.

The platform's existing grading philosophy carries over unchanged: deterministic checks run first and free, model calls run last and capped.

---

## 2. The question object

```yaml
slug: explain-why-your-loop-terminates
title: Explain how you guarantee an agent loop terminates
track: agent-loop
difficulty: medium
total_seconds: 285
competencies: [agent-loop, failure-mode-analysis, client-communication]

prompt_text: |
  A client asks why your agent will not spin forever in production.
  Answer as you would in the room.

prompt_audio: optional, generated once and cached

beats:
  - id: b1
    label: Name the risk in one sentence
    seconds: 30
    anchors: ["loop", "forever", "budget", "never stops", "runaway"]
  - id: b2
    label: Name the mechanism that stops it
    seconds: 60
    anchors: ["step budget", "max steps", "call cap", "counter", "ceiling"]
  - id: b3
    label: Say what happens when the mechanism fires
    seconds: 60
    anchors: ["degrade", "fallback", "partial answer", "escalate", "hand off"]
  - id: b4
    label: Name the case the mechanism does not catch
    seconds: 75
    anchors: ["repeated identical", "same tool", "progress", "no new information"]
  - id: b5
    label: Say what you would monitor
    seconds: 60
    anchors: ["alert", "p95", "step count", "dashboard", "log"]

follow_ups:                      # pressure mode only
  - trigger_after_beat: b3
    text: The client says a step budget just truncates good answers. Respond.
  - trigger_after_beat: b4
    text: How would you set the budget number without guessing?

rubric:
  - { label: Correct mechanism, weight: 30 }
  - { label: Names a case the mechanism misses, weight: 30 }
  - { label: Answer a non-engineer could act on, weight: 25 }
  - { label: Holds position under the follow-up, weight: 15 }

exemplars:
  - { band: strong,   score: 90, transcript: "..." }
  - { band: adequate, score: 62, transcript: "..." }
  - { band: weak,     score: 28, transcript: "..." }
```

Beats are the answer pathway. Anchors are cheap string matches used for live cues only. The rubric judge does the real scoring afterwards, and never sees the anchors.

Authoring rule: four to six beats. Three is not a pathway, seven is a script.

---

## 3. Guided mode, the cockpit

### Layout

```
+--------------------------------------------------------------+
|  Explain how you guarantee an agent loop terminates    4:45   |
+--------------------------------------------------------------+
|                                                              |
|   [====|====|====|====|====]                                 |
|    b1   b2   b3   b4   b5                                    |
|    ok   ok   NOW  --   --                                    |
|                                                              |
|            +-------------------------+                       |
|            |   ON BUDGET    0:38     |                       |
|            +-------------------------+                       |
|                                                              |
|   territory   step budget · degrade · fallback · escalate    |
|                                                              |
|   ................ [ mic level ] ................            |
|                                                              |
|   > Say what happens when the budget runs out.               |
|                                                              |
|                                    [ Stop and debrief ]      |
+--------------------------------------------------------------+
```

### The five live instruments, and nothing else

| Instrument | What it does |
|---|---|
| **Beat track** | Five segments. Passed beats fill, the current beat pulses slowly, future beats stay outlines. This is the primary instrument and it is the only thing that should catch the eye. |
| **Pace band** | Three states on the current beat: `ON BUDGET`, `STRETCHING` past 130 percent of the beat's seconds, `OVERRUN` past 175 percent. One word and a clock, nothing else. |
| **Territory** | The current beat's anchor terms, dimmed. A term brightens when the learner says it. These are landmarks, not answers; seeing `degrade` does not tell you what to say about it. |
| **Mic level** | A single horizontal meter. Its only job is to prove the microphone is live, because a learner who is not sure whether they are being heard stops thinking about the answer. |
| **Nudge slot** | One fixed line at the bottom. One nudge at a time, minimum 20 seconds between nudges, never stacked, never more than nine words. |

### Nudges

| Condition | Line |
|---|---|
| Silence over 5 seconds | Say the next step out loud. |
| Beat at OVERRUN | Move on. Three beats left. |
| Beat skipped, later beat anchors hit first | You jumped past the constraint. |
| Off-question for 20 seconds | You have left the question. |
| Under 15 seconds remaining | Close it now. |

Filler words get no live nudge. Counting "um" at someone mid-sentence makes the rest of the answer worse. It goes in the debrief.

### What the cockpit deliberately does not show

**No live transcript.** A learner who can see their words reads them instead of speaking. This is the single most important rule in the module and the most likely one to get built wrong by default.

Also absent: the word count, a score preview, the rubric, the total number of nudges so far, and any animation other than the pace band and the mic level.

### Cockpit visual rules

| Rule | Reason |
|---|---|
| One primary instrument, everything else peripheral | A cockpit is readable because the pilot knows where to look first |
| At most five live elements | Six is where a dashboard becomes a wall |
| Nothing moves except the pace band and the mic level | Motion is a signal, so spending it on decoration wastes it |
| Colour carries state only | Green, amber and red mean exactly one thing each, and nothing else on the screen uses them |
| No number longer than three characters during an answer | Long numbers get read, and reading interrupts speaking |
| All type at one size except the question and the clock | Hierarchy comes from position and weight, not from six sizes |

---

## 4. Unguided mode

The question, the clock, the mic level, and a stop button. No beats, no territory, no nudges, no pace band.

### Instrument replay

After an unguided run, the debrief replays the answer with the cockpit turned on: the beat track filling in real time against the recorded audio, the pace band changing as it changed, the nudges that would have fired appearing where they would have fired.

The learner sees their own answer through the instruments they did not have. This is the strongest teaching device in the module and costs nothing extra, since every metric is already computed for the debrief.

Instrument replay is the reason to build unguided mode second rather than first.

---

## 5. Pressure mode

An interviewer agent interrupts. Two interruptions maximum in one session.

```
1. Learner answers into beat b3.
2. At the beat boundary, the follow-up fires. Audio plays through
   text to speech, the beat track greys out, a 60 second clock appears.
3. Learner responds. The clock returns to the main track afterwards
   with the remaining time unchanged, so an interruption costs the
   session nothing and costs the learner their composure, which is
   the point.
```

Follow-ups come from the question's authored bank first. A model-generated follow-up conditioned on the partial transcript is a later addition, and only when the authored bank proves too predictable.

Pressure mode is capped at the rehearsal allowance, two per week, since it is the expensive mode in both tokens and nerves.

---

## 6. Scoring

| Axis | Weight | Computed by |
|---|---|---|
| Content | 50 | Rubric judge over the final transcript, anchored on three exemplars |
| Structure | 30 | Deterministic. Beat coverage, beat order, and whether each beat was reached before its budget ran out. |
| Pace | 20 | Deterministic. Time to first substantive claim, count of overrun beats, whether the answer closed inside the clock. |
| Delivery | 0 | Reported, never scored. Filler rate, longest silence, words per minute. |

### The fairness rule

Delivery is never scored and never gates readiness. Most learners here speak English as a second or third language. Scoring fluency, accent, pace against a native-speaker band, or filler rate would measure the wrong thing and would tell a strong engineer they are weak.

Report the numbers, since a learner who wants to work on filler words deserves to see the count. Keep them out of the score, out of the competency heatmap, and out of anything a placement conversation reads.

Structure and pace are scored because they are about the answer, not the speaker. Reaching the failure-mode beat is a content skill. Speaking quickly is not.

### Debrief

```
+--------------------------------------------------------------+
| Score 74           Content 38/50   Structure 24/30  Pace 12/20|
+--------------------------------------------------------------+
| [ replay with instruments ]        [ play audio ]  4:52       |
+--------------------------------------------------------------+
| BEATS                                                        |
| b1 Name the risk           covered   0:26   on budget        |
| b2 Name the mechanism      covered   1:14   stretching       |
| b3 What happens when fired covered   0:48   on budget        |
| b4 The case it misses      missed      --   never reached    |
| b5 What you would monitor  covered   0:31   rushed           |
+--------------------------------------------------------------+
| TERRITORY NOT ENTERED                                        |
| repeated identical call · no progress · same tool twice      |
+--------------------------------------------------------------+
| JUDGE                                                        |
| The mechanism was correct and clearly put. The answer never   |
| reached the case a step budget does not catch, which is the   |
| half of this question an interviewer is listening for.        |
+--------------------------------------------------------------+
| DELIVERY (not scored)                                        |
| 148 words per minute · 11 fillers · longest pause 6s          |
+--------------------------------------------------------------+
| TRANSCRIPT                                     [ expand ]     |
+--------------------------------------------------------------+
```

---

## 7. Technical design

### Capture

`getUserMedia` with `echoCancellation` and `noiseSuppression` on, an `AudioWorklet` downsampling to 16kHz mono PCM, frames pushed every 100ms. The `MediaRecorder` copy is kept separately for playback and written to S3 at the end.

Run a 5-second microphone check before the first session and before any Pressure run. A learner who discovers their microphone is muted at 0:40 has lost the attempt.

### Streaming

The browser opens a WebSocket to the voice session endpoint. Vercel's serverless functions are a poor fit for a long bidirectional socket, so this endpoint is separate infrastructure: API Gateway WebSocket API in front of a Lambda, on the same AWS account as the runner. Verify the current WebSocket API limits against the AWS documentation before building, and set an idle timeout below the platform maximum so an abandoned session cannot hold a connection.

The browser never holds AWS credentials. The application mints a short-lived signed session token that the socket presents on connect.

### Speech to text

Build behind an adapter interface with one method: stream PCM in, receive partial and final transcript events out.

```ts
interface SttAdapter {
  open(sessionId: string, opts: {sampleRate: number, language: string}): Promise<void>
  push(frame: Int16Array): void
  onPartial(cb: (text: string, startMs: number) => void): void
  onFinal(cb: (text: string, startMs: number, endMs: number) => void): void
  close(): Promise<void>
}
```

Ship with Amazon Transcribe streaming, which returns partial and final transcription events over WebSocket, HTTP/2 or the AWS SDK, and sits in the account you already have with no new vendor to contract.

Keep a second adapter ready. Vendor-published benchmarks put Amazon Transcribe's median time to a final transcript around one second against roughly a third of that for purpose-built realtime providers, which matters for live cue responsiveness. Those figures come from competitors, so treat them as a reason to measure rather than as a result. Measure time to first partial on your own learners' audio during Phase 8 and switch adapters only if the cockpit feels laggy in real use.

Live cues run on **partial** transcripts and cheap string matching against the beat anchors. The rubric judge runs once, at the end, on the final transcript. No model call happens while the learner is speaking.

### Text to speech

Pressure mode follow-ups and optional question read-aloud use Amazon Polly. Generate once per question and cache the audio in S3, since question text rarely changes and re-synthesising on every session wastes money for no benefit.

### Beat coverage detection

Two passes, matching the platform's existing cheap-first rule.

| Pass | When | How |
|---|---|---|
| Live | During the answer | Normalised substring match of beat anchors against the rolling partial transcript. Fast, free, occasionally wrong, and wrong in the forgiving direction. |
| Final | In the debrief | The judge is given the beat labels and the final transcript and asked which beats the answer actually covered. This is what the score uses. |

The two can disagree. When they do, the debrief shows the final result and the replay shows what the live pass did, which is honest and occasionally instructive.

---

## 8. Data model additions

```sql
create type voice_mode as enum ('guided', 'unguided', 'pressure');

create table voice_question (
  id            bigint generated always as identity primary key,
  slug          text not null unique,
  title         text not null,
  track         text not null,
  difficulty    difficulty not null,
  total_seconds int not null,
  prompt_text   text not null,
  prompt_audio_key text,
  source_yaml   text not null,
  is_published  boolean not null default false
);

create table voice_beat (
  id                bigint generated always as identity primary key,
  voice_question_id bigint not null references voice_question(id),
  beat_key          text not null,
  label             text not null,
  seconds           int not null,
  anchors           text[] not null,
  ordinal           int not null,
  unique (voice_question_id, beat_key)
);

create table voice_session (
  id                bigint generated always as identity primary key,
  enrolment_id      bigint not null references enrolment(id),
  voice_question_id bigint not null references voice_question(id),
  cohort_id         bigint not null references cohort(id),
  mode              voice_mode not null,
  started_at        timestamptz not null default now(),
  finished_at       timestamptz,
  audio_s3_key      text,
  audio_deleted_at  timestamptz,
  transcript        text,
  content_score     numeric(5,2),
  structure_score   numeric(5,2),
  pace_score        numeric(5,2),
  score             numeric(5,2),
  delivery          jsonb,        -- wpm, filler_count, longest_pause_ms
  judge_result      jsonb
);

create table voice_beat_result (
  id               bigint generated always as identity primary key,
  voice_session_id bigint not null references voice_session(id),
  beat_key         text not null,
  covered          boolean not null,
  live_covered     boolean not null,
  reached_at_ms    int,
  spent_ms         int,
  pace_state       text not null  -- on_budget, stretching, overrun, never_reached
);

create table voice_nudge (
  id               bigint generated always as identity primary key,
  voice_session_id bigint not null references voice_session(id),
  at_ms            int not null,
  kind             text not null,
  line             text not null,
  was_shown        boolean not null   -- false in unguided, replayed in the debrief
);

create table voice_consent (
  id           bigint generated always as identity primary key,
  enrolment_id bigint not null references enrolment(id) unique,
  granted_at   timestamptz not null default now(),
  revoked_at   timestamptz
);
```

`voice_nudge.was_shown` is what makes instrument replay work in unguided mode. Nudges are computed in both modes and only rendered in one.

---

## 9. Audio privacy

| Rule | Implementation |
|---|---|
| Consent before the first recording | A one-screen explanation of what is recorded, who can hear it and for how long, with an explicit accept. No session starts without a `voice_consent` row. |
| Audio retention 30 days | S3 lifecycle rule, then the object is deleted and `audio_deleted_at` is set. Transcripts and scores survive. |
| Learner can delete their own audio at any time | A button on every past session. Deletion is immediate and irreversible, and the score stays. |
| Faculty access is not automatic | Faculty see transcripts and scores. Audio requires the learner to share that session explicitly. |
| No audio leaves the account | Audio goes to S3 in the same account. The STT adapter streams it to the provider and nothing else does. |

Say all of this on the consent screen in plain words. A learner who is unsure who is listening will not speak freely, and an interview simulator where nobody speaks freely measures nothing.

---

## 10. Rate limits

| Scope | Limit |
|---|---|
| Guided sessions | 6 per day |
| Unguided sessions | 6 per day |
| Pressure sessions | 2 per week, shared with the rehearsal allowance |

STT and TTS are metered services, so these are rows in `rate_limit_policy` like every other cap and adjustable without a deploy.

---

## 11. Launch content

Twelve questions for the first cohort, each with beats, anchors, a rubric and three exemplars.

| Track | Count | Shape |
|---|---|---|
| agent-loop | 3 | Mechanism and failure-mode questions |
| tool-schema-design | 2 | Why this schema, what breaks |
| evaluation-design | 2 | The launch conversation from the design problem set |
| system-design | 2 | Spoken architecture walkthrough |
| client-communication | 3 | Saying no to a date, explaining a limit to a non-engineer, reporting a failure |

The client-communication questions matter most and are the ones no coding platform covers.

---

## 12. Acceptance

1. A learner grants consent once and never sees the screen again.
2. The microphone check detects a muted or absent device before a session starts.
3. Live beat lighting responds within one second of the anchor being spoken.
4. No model call is made while the learner is speaking. Assert the count is zero during the answer window.
5. The nudge slot never shows two lines at once and never shows a line within 20 seconds of the previous one.
6. No transcript text appears anywhere on screen during an answer, in any mode.
7. An unguided session replays with instruments and shows every nudge that would have fired.
8. Delivery metrics appear in the debrief and nowhere in the score, the heatmap, or the CSV export used for placement.
9. A session abandoned mid-answer closes its socket, saves the partial transcript, and does not consume the daily allowance.
10. Deleting audio removes the S3 object and leaves the score intact.
