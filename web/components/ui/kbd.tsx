import type { ReactNode } from "react";
import { cn } from "./cn";

/** A key on the keyboard, for shortcuts shown next to the action they run. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd className={cn(
      "inline-flex h-5 min-w-5 items-center justify-center rounded-key border",
      "border-border-strong bg-surface-2 px-1 font-sans text-meta leading-none text-text-dim",
      className)}>
      {children}
    </kbd>
  );
}
