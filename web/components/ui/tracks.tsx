/**
 * How each chapter and stage is drawn: an icon and a name.
 *
 * The names live in lib/problems/vocabulary.ts with the tracks themselves;
 * this file only adds the icon, so the vocabulary module stays free of React.
 */
import {
  Activity, BookOpenText, Compass, GitBranch, FlaskConical, Handshake, Hammer, History, LifeBuoy, Network, Repeat,
  ShieldCheck, UserCheck, Wrench, Braces, type LucideIcon,
} from "lucide-react";
import { STAGES, TRACK_NAMES, TRACKS, type Track } from "@/lib/problems/vocabulary";
import { cn } from "./cn";

export const TRACK_ICONS: Readonly<Record<Track, LucideIcon>> = {
  "loop": Repeat,
  "tools": Wrench,
  "harness": LifeBuoy,
  "context": BookOpenText,
  "memory": History,
  "orchestration": Network,
  "guardrails": ShieldCheck,
  "human-in-the-loop": UserCheck,
  "evals": FlaskConical,
  "observability": Activity,
  "agentic-pdlc": Compass,
  "agentic-sdlc": GitBranch,
  "builds": Hammer,
  "fde-practice": Handshake,
};

export function isTrack(value: string): value is Track {
  return (TRACKS as readonly string[]).includes(value);
}

export function trackName(track: string): string {
  return isTrack(track) ? TRACK_NAMES[track] : track.replace(/-/g, " ");
}

export function stageOf(track: string): (typeof STAGES)[number] | undefined {
  return STAGES.find((stage) => (stage.tracks as readonly string[]).includes(track));
}

export function TrackIcon({ track, className }: { track: string; className?: string }) {
  const Icon = isTrack(track) ? TRACK_ICONS[track] : Braces;
  return <Icon aria-hidden className={cn("size-4 shrink-0", className)} strokeWidth={1.75} />;
}

export function TrackLabel({ track, topic, className }: {
  track: string; topic?: string | null; className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-text-dim", className)}>
      <TrackIcon track={track} className="size-3.5" />
      <span>{trackName(track)}</span>
      {topic ? <span className="ml-2.5 text-text-faint">{topic}</span> : null}
    </span>
  );
}
