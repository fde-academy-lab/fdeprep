"use client";
/**
 * The three panes every workspace has: the problem, the editor, and the dock
 * under the editor with the coach and the results.
 *
 * On a wide screen they sit side by side in resizable splits. Below 768px a
 * split leaves every pane too narrow to read a sentence, so the panes become
 * tabs that each take the whole screen. All three stay mounted, so the editor
 * keeps its text and its undo history across a tab change, and the dock's tab
 * carries a dot when something lands there while another tab is open.
 */
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { cn } from "@/components/ui/cn";
import { Split } from "./split";

const NARROW = "(max-width: 767px)";

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(NARROW);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** Wide on the server, then the real answer on the first client render. */
function useNarrow(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(NARROW).matches, () => false);
}

type Pane = "problem" | "editor" | "dock";

export function WorkspaceLayout({ storageKey, left, editor, dock, editorLabel, editorShare,
                                  dockSignal }: {
  storageKey: string;
  left: ReactNode;
  editor: ReactNode;
  dock: ReactNode;
  /** What the editor holds, as the phone tab names it: Code, Prompt or Answer. */
  editorLabel: string;
  /** The editor's share of the right-hand column on a wide screen, in percent. */
  editorShare: number;
  /** Anything that changes when the dock has something new to show. */
  dockSignal: string;
}) {
  const narrow = useNarrow();
  const [pane, setPane] = useState<Pane>("problem");
  const [unseen, setUnseen] = useState(false);
  const firstSignal = useRef(dockSignal);

  useEffect(() => {
    if (dockSignal === firstSignal.current) return;
    firstSignal.current = dockSignal;
    if (pane !== "dock") setUnseen(true);
  }, [dockSignal, pane]);

  if (!narrow) {
    return (
      <Split direction="row" storageKey={`${storageKey}.left`} initial={42} min={26} max={62}
             label="Resize the problem pane" className="min-h-0 flex-1" first={left}
             second={
               <Split direction="column" storageKey={`${storageKey}.editor`} initial={editorShare}
                      min={25} max={85} label="Resize the editor" className="h-full"
                      first={editor} second={dock} />
             } />
    );
  }

  const tabs: Array<{ id: Pane; label: string }> = [
    { id: "problem", label: "Problem" },
    { id: "editor", label: editorLabel },
    { id: "dock", label: "Coach and results" },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div role="tablist" aria-label="Workspace panes"
           className="grid shrink-0 grid-cols-3 border-b border-border bg-bg">
        {tabs.map((tab) => (
          <button key={tab.id} type="button" role="tab" id={`pane-tab-${tab.id}`}
                  aria-selected={pane === tab.id} aria-controls={`pane-${tab.id}`}
                  onClick={() => {
                    setPane(tab.id);
                    if (tab.id === "dock") setUnseen(false);
                  }}
                  className={cn("relative -mb-px h-11 border-b-2 px-2 text-meta font-medium",
                                pane === tab.id ? "border-accent text-text"
                                  : "border-transparent text-text-dim")}>
            {tab.label}
            {tab.id === "dock" && unseen ? (
              <span className="absolute right-3 top-3 size-2 rounded-full bg-accent">
                <span className="sr-only">, something new</span>
              </span>
            ) : null}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <div key={tab.id} id={`pane-${tab.id}`} role="tabpanel" aria-labelledby={`pane-tab-${tab.id}`}
             hidden={pane !== tab.id} className="relative min-h-0 flex-1">
          {tab.id === "problem" ? left : tab.id === "editor" ? editor : dock}
        </div>
      ))}
    </div>
  );
}
