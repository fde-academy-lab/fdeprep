/**
 * The workspace's own top bar: where you are, what this is, and the two
 * actions that matter, in 48 pixels. It replaces the global header on this
 * screen because the editor needs the height more than the section links do.
 */
import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";
import { ChevronRight, Search } from "lucide-react";
import type { PaletteProblem } from "@/lib/problems/catalogue";
import type { Difficulty } from "@/lib/policy/tiers";
import { LogoMark } from "@/components/ui/logo";
import { DifficultyMeter } from "@/components/ui/difficulty";
import { Kbd } from "@/components/ui/kbd";
import { TrackIcon, trackName } from "@/components/ui/tracks";
import { CommandPalette, type PalettePage } from "@/components/shell/command-palette";
import { PaletteButton } from "@/components/shell/palette-button";

export function ProblemBar({ title, track, difficulty, palette, pages, actions, status }: {
  title: string;
  track: string;
  difficulty: Difficulty;
  palette: PaletteProblem[];
  pages: PalettePage[];
  actions: ReactNode;
  /** Small, factual state such as submits left today. */
  status?: ReactNode;
}) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-bg px-3">
      <Link href="/" aria-label="FDE Prep home" className="rounded-control">
        <LogoMark />
      </Link>
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-text-dim">
        <Link href="/problems" className="hidden whitespace-nowrap rounded-control px-1.5 py-1
                                          hover:bg-surface-2 hover:text-text sm:inline">
          Problems
        </Link>
        <ChevronRight aria-hidden className="hidden size-3.5 shrink-0 text-text-faint sm:block" />
        <Link href={{ pathname: "/problems" as Route, query: { track } }}
              className="hidden items-center gap-1.5 whitespace-nowrap rounded-control px-1.5 py-1
                         hover:bg-surface-2 hover:text-text md:inline-flex">
          <TrackIcon track={track} className="size-3.5" />
          {trackName(track)}
        </Link>
        <ChevronRight aria-hidden className="hidden size-3.5 shrink-0 text-text-faint md:block" />
        <h1 className="truncate px-1.5 font-semibold text-text">{title}</h1>
      </nav>
      <DifficultyMeter difficulty={difficulty} className="hidden shrink-0 lg:inline-flex" />

      <div className="ml-auto flex shrink-0 items-center gap-2">
        {status ? <span className="hidden text-meta text-text-faint xl:inline">{status}</span> : null}
        <PaletteButton wide={false}>
          <Search aria-hidden className="size-4 text-text-faint" />
          <span className="hidden items-center gap-0.5 sm:inline-flex"><Kbd>⌘</Kbd><Kbd>K</Kbd></span>
        </PaletteButton>
        {actions}
      </div>
      <CommandPalette problems={palette} pages={pages} />
    </header>
  );
}
