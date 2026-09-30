/**
 * docs/08 section 6: an empty state is one sentence naming the next action,
 * and a button. The icon is the only decoration it gets.
 */
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "./cn";

export function EmptyState({ icon: Icon, children, action, className }: {
  icon: LucideIcon;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn(
      "flex flex-col items-start gap-3 rounded-panel border border-dashed border-border-strong",
      "px-5 py-6 sm:flex-row sm:items-center", className)}>
      <span className="grid size-9 shrink-0 place-items-center rounded-control border
                       border-border bg-surface-2 text-text-dim">
        <Icon aria-hidden className="size-4" strokeWidth={1.75} />
      </span>
      <p className="grow text-text-dim">{children}</p>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
