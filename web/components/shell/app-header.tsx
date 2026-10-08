/**
 * The header on every full-page screen.
 *
 * Server component: it reads who is signed in and builds the palette's index,
 * and hands the two small interactive parts, the section links and the
 * palette, to client components.
 */
import Link from "next/link";
import type { Route } from "next";
import { Compass, LogOut, Mic, Search } from "lucide-react";
import type { Learner } from "@/lib/session/current";
import type { PaletteProblem } from "@/lib/problems/catalogue";
import { Wordmark } from "@/components/ui/logo";
import { Kbd } from "@/components/ui/kbd";
import { CommandPalette } from "./command-palette";
import { palettePages } from "./palette-pages";
import { NavLinks, type NavItem } from "./nav-links";
import { PaletteButton } from "./palette-button";

const SECTIONS: NavItem[] = [
  { href: "/", label: "Home" },
  { href: "/problems", label: "Problems" },
  { href: "/rehearsal", label: "Rehearsal" },
  { href: "/voice", label: "Voice" },
  { href: "/progress", label: "Progress", also: ["/traces"] },
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? [parts[0]![0], parts[parts.length - 1]![0]] : [name[0], name[1]];
  return letters.filter(Boolean).join("").toUpperCase();
}

export function AppHeader({ learner, problems }: { learner: Learner; problems: PaletteProblem[] }) {
  const sections = learner.role === "learner"
    ? SECTIONS
    : [...SECTIONS, { href: "/admin" as Route, label: "Admin" }];

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-bg/85 backdrop-blur-md
                       supports-[backdrop-filter]:bg-bg/70">
      <div className="mx-auto flex h-14 max-w-[1280px] items-center gap-4 px-4 sm:px-6">
        <Link href="/" className="rounded-control text-text" aria-label="FDE Prep home">
          <Wordmark />
        </Link>

        <div className="hidden md:block">
          <NavLinks items={sections} />
        </div>

        <div className="ml-auto flex items-center gap-2">
          <PaletteButton>
            <Search aria-hidden className="size-4 text-text-faint" />
            <span className="hidden text-text-faint lg:inline">Search or jump to</span>
            <span className="hidden items-center gap-0.5 sm:inline-flex">
              <Kbd>⌘</Kbd><Kbd>K</Kbd>
            </span>
          </PaletteButton>

          <details className="group relative">
            <summary
              aria-label={`Account menu for ${learner.displayName}`}
              className="grid size-8 cursor-pointer list-none place-items-center rounded-full
                         border border-border-strong bg-surface-3 text-meta font-semibold
                         text-text-dim hover:text-text [&::-webkit-details-marker]:hidden">
              {initials(learner.displayName)}
            </summary>
            <div className="absolute right-0 top-10 z-40 w-60 rounded-panel border
                            border-border-strong bg-surface p-1.5
                            shadow-[0_16px_40px_-12px_rgb(0_0_0/0.55)] rise-in">
              <div className="px-2.5 py-2">
                <p className="truncate font-medium text-text">{learner.displayName}</p>
                <p className="text-meta text-text-faint first-letter:uppercase">
                  {learner.role === "learner" ? `${learner.persona} path` : learner.role}
                </p>
              </div>
              <div className="my-1 h-px bg-border" />
              <Link href="/progress"
                    className="flex items-center gap-2 rounded-control px-2.5 py-1.5 text-text-dim
                               hover:bg-surface-2 hover:text-text">
                <Compass aria-hidden className="size-4" strokeWidth={1.75} /> Progress
              </Link>
              <Link href="/voice/sessions"
                    className="flex items-center gap-2 rounded-control px-2.5 py-1.5 text-text-dim
                               hover:bg-surface-2 hover:text-text">
                <Mic aria-hidden className="size-4" strokeWidth={1.75} /> Past answers
              </Link>
              <form action="/api/auth/signout" method="post">
                <button type="submit"
                        className="flex w-full items-center gap-2 rounded-control px-2.5 py-1.5
                                   text-left text-text-dim hover:bg-surface-2 hover:text-text">
                  <LogOut aria-hidden className="size-4" strokeWidth={1.75} /> Sign out
                </button>
              </form>
            </div>
          </details>
        </div>
      </div>

      <div className="overflow-x-auto border-t border-border px-2 py-1.5 md:hidden">
        <NavLinks items={sections} underline={false} />
      </div>

      <CommandPalette problems={problems} pages={palettePages(learner.role)} />
    </header>
  );
}
