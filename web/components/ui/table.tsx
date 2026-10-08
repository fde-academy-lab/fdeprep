/**
 * The one table. docs/08 section 6: 36 pixel rows, 12 pixels of horizontal
 * padding, figures in tabular numerals, the header row at the meta size, one
 * border between rows and the panel radius on the wrapper. Twenty rows fit
 * in a 900 pixel viewport.
 *
 * Nothing scrolls sideways unless a page passes minWidth for a table whose
 * columns cannot wrap.
 */
import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";

export function Table({ head, children, widths, minWidth, className }: {
  /** A Head. */
  head: ReactNode;
  /** Rows. */
  children: ReactNode;
  /** Fixed column widths in pixels, null for the column that takes the rest. */
  widths?: ReadonlyArray<number | null>;
  minWidth?: number;
  className?: string;
}) {
  return (
    <div className={cn("overflow-x-auto rounded-panel border border-border bg-surface", className)}>
      <table className={cn("w-full border-collapse text-left leading-[1.4]", widths && "table-fixed")}
             style={minWidth ? { minWidth } : undefined}>
        {widths ? (
          <colgroup>
            {widths.map((width, index) => (
              <col key={index} style={width ? { width } : undefined} />
            ))}
          </colgroup>
        ) : null}
        {head}
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  );
}

/** The header row. Its cells are Cell or NumCell with `head`. */
export function Head({ children }: { children: ReactNode }) {
  return (
    <thead className="bg-surface-2 text-meta text-text-faint">
      <tr className="h-9 border-b border-border">{children}</tr>
    </thead>
  );
}

export function Row({ children, className }: { children: ReactNode; className?: string }) {
  return <tr className={cn("h-9", className)}>{children}</tr>;
}

export function Cell({ head = false, className, ...rest }:
  ComponentProps<"td"> & { head?: boolean }) {
  const classes = cn("px-3 py-1.5 align-middle", head && "font-medium", className);
  return head
    ? <th scope="col" className={classes} {...rest} />
    : <td className={classes} {...rest} />;
}

/** A figure: right-aligned, in tabular numerals. */
export function NumCell({ className, ...rest }: ComponentProps<"td"> & { head?: boolean }) {
  return <Cell className={cn("tnum text-right", className)} {...rest} />;
}
