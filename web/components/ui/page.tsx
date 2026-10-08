/**
 * The measure every learner page uses: the chapter page's 960 pixels, one
 * column, 40 pixels between blocks. Roominess comes from this and from
 * spacing, never from a bigger type size (docs/08 section 2).
 */
import type { ReactNode } from "react";
import { cn } from "./cn";

export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <main className={cn("mx-auto max-w-[960px] space-y-10 px-6 pb-16 pt-8", className)}>
      {children}
    </main>
  );
}

/** The h1, an optional line under it, and one action at the right of the row. */
export function PageHeading({ title, line, action }: {
  title: string; line?: ReactNode; action?: ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-display font-semibold tracking-[-0.02em] text-text">{title}</h1>
        {line ? <p className="mt-1 max-w-[70ch] text-text-dim">{line}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/** A block's h2, with a text link or a count at the right of the row. */
export function SectionHeading({ title, id, action }: {
  title: string; id?: string; action?: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <h2 id={id} className="text-title font-semibold tracking-[-0.01em] text-text">{title}</h2>
      {action ? <div className="shrink-0 text-meta text-text-dim">{action}</div> : null}
    </div>
  );
}
