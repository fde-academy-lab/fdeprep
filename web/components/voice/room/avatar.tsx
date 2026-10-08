/**
 * An interviewer's head at 24 pixels, for the picker chips and the
 * interviewers page. It is the head rows of the room figure on a 12 by 12
 * tile of the page background with the corners cut, so the same face appears
 * in the chip and at the table. Decorative: the chip carries the name.
 */
import type { JSX } from "react";
import { PixelGrid } from "./pixel";
import { FIGURES, PALETTE, stamp, toCells, toRows } from "./sprites";

const TILE = 12;
const CELL = 2;
/** Hair through the shoulders: figure rows 0 to 9. */
const HEAD_ROWS = 10;

const BLANK_TILE: string[] = [
  ".wwwwwwwwww.",
  "wwwwwwwwwwww",
  "wwwwwwwwwwww",
  "wwwwwwwwwwww",
  "wwwwwwwwwwww",
  "wwwwwwwwwwww",
  "wwwwwwwwwwww",
  "wwwwwwwwwwww",
  "wwwwwwwwwwww",
  "wwwwwwwwwwww",
  "wwwwwwwwwwww",
  ".wwwwwwwwww.",
];

export function avatarRows(slug: string): string[] {
  const figure = FIGURES[slug] ?? FIGURES.neutral!;
  const cells = toCells(BLANK_TILE);
  const head = figure.slice(0, HEAD_ROWS);
  stamp(cells, head, Math.floor((TILE - figure[0]!.length) / 2), 1);
  return toRows(cells);
}

export function InterviewerAvatar({ slug }: { slug: string }): JSX.Element {
  return <PixelGrid rows={avatarRows(slug)} palette={PALETTE} cell={CELL} className="shrink-0" />;
}
