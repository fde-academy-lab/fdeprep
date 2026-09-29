/**
 * How each track and stage is drawn: an icon and a name.
 *
 * The names live in lib/problems/vocabulary.ts with the tracks themselves;
 * this file only adds the icon, so the vocabulary module stays free of React.
 */
import {
  Activity, BookOpenText, Braces, FlaskConical, Handshake, Hammer, History, MessageSquareText,
  Repeat, ShieldCheck, Wrench, type LucideIcon,
} from "lucide-react";
import { STAGES, TRACK_NAMES, TRACKS, type Track } from "@/lib/problems/vocabulary";
import { cn } from "./cn";

export const TRACK_ICONS: Readonly<Record<Track, LucideIcon>> = {
  "structured-output": Braces,
  "prompt": MessageSquareText,
  "agent-loop": Repeat,
  "tool-creation": Wrench,
  "rag": BookOpenText,
  "memory": History,
  "guardrails": ShieldCheck,
  "evals": FlaskConical,
  "production": Activity,
  "fde-practice": Handshake,
  "builds": Hammer,
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

export function TrackLabel({ track, className }: { track: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-text-dim", className)}>
      <TrackIcon track={track} className="size-3.5" />
      <span>{trackName(track)}</span>
    </span>
  );
}
