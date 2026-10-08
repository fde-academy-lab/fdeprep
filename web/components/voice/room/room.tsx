/**
 * The interview room: the scene with the interviewers seated at the table and
 * the learner's chair empty in the foreground, because the learner is the one
 * looking at the room.
 *
 * One person takes the middle seat. A panel of three seats its first entry,
 * the chair, in the middle with the other two either side. A slug the sprites
 * do not know gets the neutral figure, so a new persona never breaks the
 * lobby. The image names everyone in it for assistive technology.
 *
 * Lobby: 400 by 240 pixels at 5 per cell. Debrief: 240 by 144 at 3 per cell.
 * The cockpit never imports this, and tests/voice-room.test.ts says so.
 */
import type { JSX } from "react";
import { PixelGrid } from "./pixel";
import {
  CHAIR_BACK, FIGURE_WIDTH, FIGURES, LAYOUT, LEARNER_CHAIR, PALETTE, PROPS, SCENE, stamp, TABLE, toCells,
  toRows,
} from "./sprites";

export type RoomSize = "lobby" | "debrief";

export interface RoomPerson {
  slug: string;
  name: string;
  role: string;
}

const CELL: Record<RoomSize, number> = { lobby: 5, debrief: 3 };

/** Seat centres by party size, in scene columns. The first entry is the middle seat. */
const SEATS: Record<number, number[]> = {
  1: [40],
  2: [30, 50],
  3: [40, 24, 56],
};

function seatsFor(count: number): number[] {
  return SEATS[Math.min(count, 3)] ?? [];
}

function describe(interviewers: RoomPerson[]): string {
  if (interviewers.length === 0) return "An empty interview room";
  const names = interviewers.map((person) => `${person.name}, ${person.role}`);
  const listed = names.length === 1
    ? names[0]!
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]!}`;
  return `${listed}, at the interview table`;
}

/** The room with everyone seated, as rows of palette characters. */
export function composeRoom(interviewers: RoomPerson[]): string[] {
  const cells = toCells(SCENE);
  const seated = interviewers.slice(0, 3);
  const seats = seatsFor(seated.length);
  seated.forEach((person, index) => {
    const centre = seats[index]!;
    stamp(cells, CHAIR_BACK, centre - Math.floor(CHAIR_BACK[0]!.length / 2), LAYOUT.chairTop);
    stamp(cells, FIGURES[person.slug] ?? FIGURES.neutral!, centre - Math.floor(FIGURE_WIDTH / 2), LAYOUT.figureTop);
  });
  stamp(cells, TABLE, LAYOUT.table.x, LAYOUT.table.y);
  seated.forEach((person, index) => {
    const prop = PROPS[person.slug];
    if (!prop) return;
    const centre = seats[index]!;
    const width = prop[0]!.length;
    // Props stand on the table top, so a tall prop rises in front of the torso.
    stamp(cells, prop, centre - Math.floor(width / 2), LAYOUT.propTop + 1 - prop.length);
  });
  stamp(cells, LEARNER_CHAIR, LAYOUT.learnerChair.x, LAYOUT.learnerChair.y);
  return toRows(cells);
}

export function InterviewRoom({ interviewers, size }: { interviewers: RoomPerson[]; size: RoomSize }): JSX.Element {
  return (
    <PixelGrid
      rows={composeRoom(interviewers)}
      palette={PALETTE}
      cell={CELL[size]}
      label={describe(interviewers)}
    />
  );
}
