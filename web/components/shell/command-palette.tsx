"use client";
/**
 * The command palette: Cmd K or Ctrl K anywhere, or / when the cursor is not
 * in a text field, opens a search over every problem and every screen.
 *
 * A native modal dialog does the hard parts: the rest of the page goes inert,
 * focus stays inside, and Escape closes it. The list follows the ARIA combobox
 * pattern so a screen reader hears which result is active.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import {
  ArrowRight, ChartNoAxesColumn, CornerDownLeft, House, LayoutList, Mic, Search, Settings, Timer,
  type LucideIcon,
} from "lucide-react";
import type { PaletteProblem } from "@/lib/problems/catalogue";
import { search } from "@/lib/ui/palette-search";
import { DifficultyMeter } from "@/components/ui/difficulty";
import { Kbd } from "@/components/ui/kbd";
import { StatusIcon } from "@/components/ui/status";
import { TrackIcon, trackName } from "@/components/ui/tracks";
import { cn } from "@/components/ui/cn";

/**
 * Icons by name, because a server component cannot hand a component function
 * to a client one.
 */
const PAGE_ICONS = {
  home: House, problems: LayoutList, rehearsal: Timer, voice: Mic,
  progress: ChartNoAxesColumn, admin: Settings,
} satisfies Record<string, LucideIcon>;

export interface PalettePage {
  href: Route;
  label: string;
  icon: keyof typeof PAGE_ICONS;
  keywords?: string;
}

type Entry =
  | { kind: "page"; key: string; page: PalettePage }
  | { kind: "problem"; key: string; problem: PaletteProblem };

const OPEN_EVENT = "fdeprep:open-palette";

/** Lets any button open the palette without holding a ref to it. */
export function openPalette() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

function typingInField(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

export function CommandPalette({ problems, pages }: {
  problems: PaletteProblem[];
  pages: PalettePage[];
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();

  const open = useCallback(() => {
    const el = dialog.current;
    if (!el || el.open) return;
    setQuery("");
    setActive(0);
    el.showModal();
    requestAnimationFrame(() => input.current?.focus());
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (dialog.current?.open) dialog.current.close();
        else open();
      } else if (event.key === "/" && !typingInField(event.target) && !dialog.current?.open) {
        event.preventDefault();
        open();
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, open);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, open);
    };
  }, [open]);

  const entries = useMemo<Entry[]>(() => {
    const q = query.trim().toLowerCase();
    const pageHits = pages.filter((page) =>
      !q || `${page.label} ${page.keywords ?? ""}`.toLowerCase().includes(q));
    const problemHits = search(problems, query, q ? 12 : 6);
    return [
      ...pageHits.map((page) => ({ kind: "page" as const, key: `page:${page.href}`, page })),
      ...problemHits.map((problem) => ({
        kind: "problem" as const, key: `problem:${problem.slug}`, problem,
      })),
    ];
  }, [query, pages, problems]);

  const go = (entry: Entry | undefined) => {
    if (!entry) return;
    dialog.current?.close();
    router.push(entry.kind === "page" ? entry.page.href : (`/problems/${entry.problem.slug}` as Route));
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => Math.min(entries.length - 1, i + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      go(entries[active]);
    }
  };

  useEffect(() => {
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, listId]);

  const firstProblem = entries.findIndex((entry) => entry.kind === "problem");

  return (
    <dialog
      ref={dialog}
      aria-label="Search problems and screens"
      onClick={(event) => { if (event.target === dialog.current) dialog.current?.close(); }}
      className="m-0 mx-auto mt-[12vh] w-[min(640px,calc(100vw-2rem))] max-w-none overflow-hidden
                 rounded-panel border border-border-strong bg-surface p-0 text-text
                 shadow-[0_24px_64px_-12px_rgb(0_0_0/0.6)] backdrop:bg-bg/70
                 backdrop:backdrop-blur-[2px] open:rise-in"
    >
      <div className="flex items-center gap-3 border-b border-border px-4">
        <Search aria-hidden className="size-4 text-text-faint" />
        <input
          ref={input}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={entries.length ? `${listId}-${active}` : undefined}
          aria-autocomplete="list"
          value={query}
          onChange={(event) => { setQuery(event.target.value); setActive(0); }}
          onKeyDown={onKeyDown}
          placeholder="Search problems, tracks or screens"
          className="h-12 grow bg-transparent text-lead text-text outline-none
                     placeholder:text-text-faint focus-visible:outline-none"
        />
        <Kbd>esc</Kbd>
      </div>

      <ul id={listId} role="listbox" aria-label="Results"
          className="relative max-h-[min(60vh,440px)] overflow-y-auto p-2">
        {entries.length === 0 ? (
          <li className="px-3 py-8 text-center text-text-dim">
            Nothing matches &ldquo;{query}&rdquo;. Try a track name, such as retrieval or evals.
          </li>
        ) : entries.map((entry, index) => (
          <li key={entry.key}>
            {index === 0 && entry.kind === "page" ? (
              <p className="px-3 pb-1 pt-2 text-meta text-text-faint">Go to</p>
            ) : null}
            {index === firstProblem ? (
              <p className="px-3 pb-1 pt-3 text-meta text-text-faint">
                {query.trim() ? "Problems" : "Problems to start with"}
              </p>
            ) : null}
            <div
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              onMouseMove={() => setActive(index)}
              onClick={() => go(entry)}
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-control px-3 py-2",
                index === active ? "bg-surface-3 text-text" : "text-text-dim")}
            >
              {entry.kind === "page" ? (
                <>
                  <PageIcon name={entry.page.icon} />
                  <span className="grow text-text">{entry.page.label}</span>
                  <ArrowRight aria-hidden className="size-3.5 text-text-faint" />
                </>
              ) : (
                <>
                  <StatusIcon kind={entry.problem.state === "solved" ? "pass" : entry.problem.state}
                              label={entry.problem.state === "solved" ? "Solved" : undefined} />
                  <span className="min-w-0 grow truncate text-text">{entry.problem.title}</span>
                  <span className="hidden items-center gap-1.5 text-meta sm:inline-flex">
                    <TrackIcon track={entry.problem.track} className="size-3.5" />
                    {trackName(entry.problem.track)}
                  </span>
                  <DifficultyMeter difficulty={entry.problem.difficulty} label={false} />
                </>
              )}
              {index === active ? (
                <CornerDownLeft aria-hidden className="size-3.5 shrink-0 text-text-faint" />
              ) : <span className="size-3.5 shrink-0" />}
            </div>
          </li>
        ))}
      </ul>

      <div className="flex items-center gap-4 border-t border-border px-4 py-2 text-meta
                      text-text-faint">
        <span className="inline-flex items-center gap-1.5"><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span>
        <span className="inline-flex items-center gap-1.5"><Kbd>↵</Kbd> open</span>
        <span className="ml-auto">{problems.length} problems</span>
      </div>
    </dialog>
  );
}

function PageIcon({ name }: { name: PalettePage["icon"] }) {
  const Icon = PAGE_ICONS[name];
  return <Icon aria-hidden className="size-4 shrink-0" strokeWidth={1.75} />;
}
