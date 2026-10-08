/**
 * A character grid as inline SVG, one rect per run of same-coloured cells.
 *
 * Every fill is a theme token, so the drawing follows the theme like any
 * other surface. The viewBox is in cells and the width is a percentage, so
 * the image scales down on a phone and stops at its stated size. There is
 * no raster, filter, gradient or animation in here, and no hook, so a server
 * component and a client component can both render it.
 */
import type { CSSProperties, JSX } from "react";

export interface PixelGridProps {
  /** Equal-length strings, one character per cell. */
  rows: string[];
  /** Character to fill. A missing entry or an empty string paints nothing. */
  palette: Record<string, string>;
  /** Pixels per cell at full size. */
  cell: number;
  /** Names the image for assistive technology. Without it the image is decorative and hidden. */
  label?: string;
  className?: string;
}

interface Run { x: number; y: number; width: number; fill: string }

/** Merges each row into horizontal runs of one colour. A 3,840 cell scene becomes a few hundred rects. */
export function runs(rows: string[], palette: Record<string, string>): Run[] {
  const out: Run[] = [];
  rows.forEach((line, y) => {
    let current: Run | null = null;
    for (let x = 0; x < line.length; x += 1) {
      const fill = palette[line[x]!] ?? "";
      if (current && current.fill === fill) {
        current.width += 1;
        continue;
      }
      current = { x, y, width: 1, fill };
      if (fill !== "") out.push(current);
    }
  });
  return out;
}

export function PixelGrid({ rows, palette, cell, label, className }: PixelGridProps): JSX.Element {
  const columns = rows[0]?.length ?? 0;
  const width = columns * cell;
  const height = rows.length * cell;
  const style: CSSProperties = { width: "100%", maxWidth: width, height: "auto", display: "block" };
  const naming = label
    ? { role: "img", "aria-label": label }
    : { "aria-hidden": true as const };
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${columns} ${rows.length}`}
      width={width}
      height={height}
      shapeRendering="crispEdges"
      style={style}
      className={className}
      {...naming}
    >
      {runs(rows, palette).map((run) => (
        <rect key={`${run.x},${run.y}`} x={run.x} y={run.y} width={run.width} height={1} fill={run.fill} />
      ))}
    </svg>
  );
}
