/**
 * State, always as a glyph and a word together. docs/08 section 3: colour
 * never carries meaning alone, because a red and green column is unreadable
 * to roughly one man in twelve.
 */
import {
  CircleCheck, CircleDashed, CircleDot, CircleX, LoaderCircle, TriangleAlert, type LucideIcon,
} from "lucide-react";
import { cn } from "./cn";

export type StatusKind = "pass" | "fail" | "error" | "running" | "queued" | "attempted" | "untouched";

const LOOK: Record<StatusKind, { icon: LucideIcon; tone: string; word: string; spin?: boolean }> = {
  pass: { icon: CircleCheck, tone: "text-pass", word: "Passed" },
  fail: { icon: CircleX, tone: "text-fail", word: "Failed" },
  error: { icon: TriangleAlert, tone: "text-warn", word: "Error" },
  running: { icon: LoaderCircle, tone: "text-info", word: "Running", spin: true },
  queued: { icon: CircleDashed, tone: "text-text-dim", word: "Queued" },
  attempted: { icon: CircleDot, tone: "text-warn", word: "Attempted" },
  untouched: { icon: CircleDashed, tone: "text-text-faint", word: "Not started" },
};

export function StatusIcon({ kind, className, label }: {
  kind: StatusKind; className?: string; label?: string;
}) {
  const look = LOOK[kind];
  const Icon = look.icon;
  return (
    <span className={cn("inline-flex", look.tone, className)} title={label ?? look.word}>
      <Icon aria-hidden className={cn("size-4", look.spin && "animate-spin")} strokeWidth={2} />
      <span className="sr-only">{label ?? look.word}</span>
    </span>
  );
}

export function StatusBadge({ kind, children, className }: {
  kind: StatusKind; children?: React.ReactNode; className?: string;
}) {
  const look = LOOK[kind];
  const Icon = look.icon;
  return (
    <span className={cn("inline-flex items-center gap-1.5 font-medium", look.tone, className)}>
      <Icon aria-hidden className={cn("size-4", look.spin && "animate-spin")} strokeWidth={2} />
      <span>{children ?? look.word}</span>
    </span>
  );
}
