"use client";
import type { ReactNode } from "react";
import { openPalette } from "./command-palette";
import { cn } from "@/components/ui/cn";

/** The visible way into the palette, for anyone who does not know Cmd K. */
export function PaletteButton({ children, className, wide = true }: {
  children: ReactNode; className?: string; wide?: boolean;
}) {
  return (
    <button type="button" onClick={openPalette} aria-label="Search or jump to"
            className={cn(
              "inline-flex h-8 items-center gap-2 rounded-control border border-border-strong",
              "bg-surface px-2.5 text-meta hover:border-border-control hover:bg-surface-2",
              wide && "lg:min-w-64", className)}>
      {children}
    </button>
  );
}
