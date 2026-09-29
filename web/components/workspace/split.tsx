"use client";
/**
 * A resizable split. Drag the rule, or focus it and use the arrow keys; the
 * position is kept per browser, which is the only place a layout preference
 * belongs.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/components/ui/cn";

export function Split({ direction, storageKey, initial, min, max, first, second, className, label }: {
  direction: "row" | "column";
  storageKey: string;
  /** Size of the first pane, in percent. */
  initial: number;
  min: number;
  max: number;
  first: ReactNode;
  second: ReactNode;
  className?: string;
  label: string;
}) {
  const [size, setSize] = useState(initial);
  const box = useRef<HTMLDivElement>(null);
  const row = direction === "row";

  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(storageKey));
      if (saved >= min && saved <= max) setSize(saved);
    } catch { /* storage blocked: the default split still works */ }
  }, [storageKey, min, max]);

  const commit = useCallback((next: number) => {
    const clamped = Math.min(max, Math.max(min, next));
    setSize(clamped);
    try { localStorage.setItem(storageKey, String(Math.round(clamped * 10) / 10)); } catch { /* blocked */ }
  }, [storageKey, min, max]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = box.current?.getBoundingClientRect();
    if (!bounds) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.style.userSelect = "none";
    const move = (e: PointerEvent) => {
      const pct = row
        ? ((e.clientX - bounds.left) / bounds.width) * 100
        : ((e.clientY - bounds.top) / bounds.height) * 100;
      setSize(Math.min(max, Math.max(min, pct)));
    };
    const up = (e: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.userSelect = "";
      const pct = row
        ? ((e.clientX - bounds.left) / bounds.width) * 100
        : ((e.clientY - bounds.top) / bounds.height) * 100;
      commit(pct);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 10 : 2;
    const back = row ? "ArrowLeft" : "ArrowUp";
    const forward = row ? "ArrowRight" : "ArrowDown";
    if (event.key === back) { event.preventDefault(); commit(size - step); }
    if (event.key === forward) { event.preventDefault(); commit(size + step); }
    if (event.key === "Home") { event.preventDefault(); commit(min); }
    if (event.key === "End") { event.preventDefault(); commit(max); }
  };

  return (
    <div ref={box} className={cn("flex min-h-0 min-w-0", row ? "flex-row" : "flex-col", className)}>
      <div style={{ flexBasis: `${size}%` }} className="min-h-0 min-w-0 shrink-0 grow-0 overflow-hidden">
        {first}
      </div>
      <div role="separator" tabIndex={0} aria-label={label}
           aria-orientation={row ? "vertical" : "horizontal"}
           aria-valuenow={Math.round(size)} aria-valuemin={min} aria-valuemax={max}
           onPointerDown={onPointerDown} onKeyDown={onKeyDown}
           className={cn("group relative z-10 shrink-0 bg-border focus-visible:outline-none",
                         row ? "w-px cursor-col-resize" : "h-px cursor-row-resize")}>
        <span aria-hidden className={cn(
          "absolute bg-transparent group-hover:bg-accent/60 group-focus-visible:bg-accent",
          row ? "-inset-x-[3px] inset-y-0" : "-inset-y-[3px] inset-x-0")} />
      </div>
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{second}</div>
    </div>
  );
}
