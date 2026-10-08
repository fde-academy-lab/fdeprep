/**
 * The interview room as character grids, plan section 4.9.
 *
 * Each character names a theme token from web/app/globals.css, so the room
 * follows the theme and never wears the accent or a state colour. The diagram
 * tones are content under docs/08 section 3, which is what lets a persona
 * wear one. Dark hair is border-strong rather than the surface-3 the plan
 * names, because surface-3 sits at 1.4 to 1 against the wall and a bun, long
 * hair or curls drawn in it cannot be seen. Every grid is a list of equal-length strings, one character per
 * cell, and "." is a cell that paints nothing.
 *
 * A figure is 9 cells wide and 13 tall: hair on rows 0 to 2, the face on 3
 * to 6 with the eyes on row 4, the neck on 7, the shoulders on 8 and the
 * torso below. Each persona differs in the hair, the clothing tone and one
 * prop, which is what tells them apart at lobby size.
 */

export const TRANSPARENT = ".";

/** Character to token. The empty string paints nothing. */
export const PALETTE: Record<string, string> = {
  [TRANSPARENT]: "",
  w: "var(--color-bg)",
  e: "var(--color-bg)",
  f: "var(--color-surface)",
  "2": "var(--color-surface-2)",
  "3": "var(--color-surface-3)",
  "-": "var(--color-border)",
  "=": "var(--color-border-strong)",
  t: "var(--color-text)",
  d: "var(--color-text-dim)",
  a: "var(--color-text-faint)",
  b: "var(--color-tone-blue)",
  g: "var(--color-tone-green)",
  p: "var(--color-tone-purple)",
  c: "var(--color-tone-teal)",
  o: "var(--color-tone-orange)",
  k: "var(--color-tone-pink)",
  n: "var(--color-tone-neutral)",
};

export const SCENE_WIDTH = 80;
export const SCENE_HEIGHT = 48;
export const FIGURE_WIDTH = 9;
export const FIGURE_HEIGHT = 13;

/*
 * The figures. Skin is text-dim (d) or text-faint (a). Hair is border-strong
 * (=) or, for grey hair, text-faint (a). Eyes are the wall colour (e).
 */
export const FIGURES: Record<string, string[]> = {
  // Bun, blue. The laptop is hers.
  "engineering-lead": [
    "...===...",
    ".=======.",
    ".=======.",
    ".=ddddd=.",
    ".=deded=.",
    "..ddddd..",
    "..ddddd..",
    "...ddd...",
    ".bbbdbbb.",
    "bbbbbbbbb",
    "bbbbbbbbb",
    "bbbbbbbbb",
    "bbbbbbbbb",
  ],
  // Short grey hair, purple jacket over a light shirt. The mug is his.
  cto: [
    ".........",
    "..aaaaa..",
    ".aaaaaaa.",
    ".addddda.",
    "..deded..",
    "..ddddd..",
    "..ddddd..",
    "...ddd...",
    ".pptdtpp.",
    "ppptttppp",
    "pppptpppp",
    "ppppppppp",
    "ppppppppp",
  ],
  // Long hair over the shoulders, orange. The phone is hers.
  ceo: [
    ".........",
    "..=====..",
    ".=======.",
    ".==aaa==.",
    ".=aeaea=.",
    ".=aaaaa=.",
    ".=aaaaa=.",
    ".==aaa==.",
    "==ooaoo==",
    "=ooooooo=",
    "ooooooooo",
    "ooooooooo",
    "ooooooooo",
  ],
  // Short hair and a beard, teal. The notebook and pen are his.
  "solution-architect": [
    ".........",
    "..=====..",
    ".=======.",
    ".=aaaaa=.",
    "..aeaea..",
    ".=aaaaa=.",
    ".=======.",
    "...aaa...",
    ".cccaccc.",
    "ccccccccc",
    "ccccccccc",
    "ccccccccc",
    "ccccccccc",
  ],
  // Short curls, green, headphones round the neck.
  "senior-ai-engineer": [
    "..=.=.=..",
    ".=======.",
    "=========",
    "==ddddd==",
    ".=deded=.",
    "..ddddd..",
    "..ddddd..",
    ".==ddd==.",
    ".g=====g.",
    "ggggggggg",
    "ggggggggg",
    "ggggggggg",
    "ggggggggg",
  ],
  // Short hair, neutral jacket, collar and tie. The folder is his.
  "hiring-manager": [
    ".........",
    "..=====..",
    ".=======.",
    ".=ddddd=.",
    "..deded..",
    "..ddddd..",
    "..ddddd..",
    "...ddd...",
    ".nntdtnn.",
    "nnnn=nnnn",
    "nnnn=nnnn",
    "nnnn=nnnn",
    "nnnnnnnnn",
  ],
  // Hair tied back with a low bun at the side, pink. The printed slide is hers.
  client: [
    ".........",
    "..=====..",
    ".=======.",
    ".=aaaaa==",
    "..aeaea.=",
    "..aaaaa..",
    "..aaaaa..",
    "...aaa...",
    ".kkkakkk.",
    "kkkkkkkkk",
    "kkkkkkkkk",
    "kkkkkkkkk",
    "kkkkkkkkk",
  ],
  // Short grey hair, glasses, purple with a blue scarf. The clipboard is hers.
  "bar-raiser": [
    ".........",
    "..aaaaa..",
    ".aaaaaaa.",
    ".addddda.",
    "..tetet..",
    "..ddddd..",
    "..ddddd..",
    "...ddd...",
    ".bbbbbbb.",
    "ppbbppppp",
    "ppbbppppp",
    "ppppppppp",
    "ppppppppp",
  ],
  // A slug the room has never met gets this figure and no prop.
  neutral: [
    ".........",
    "..=====..",
    ".=======.",
    ".=aaaaa=.",
    "..aeaea..",
    "..aaaaa..",
    "..aaaaa..",
    "...aaa...",
    ".nnnannn.",
    "nnnnnnnnn",
    "nnnnnnnnn",
    "nnnnnnnnn",
    "nnnnnnnnn",
  ],
};

/** The prop each persona keeps on the table, drawn in front of the figure. */
export const PROPS: Record<string, string[]> = {
  // An open laptop: the screen stands up in front of the torso, the base lies on the table.
  "engineering-lead": [
    ".=====.",
    ".=222=.",
    ".=222=.",
    ".=222=.",
    ".=====.",
    "aaaaaaa",
  ],
  cto: [
    "dd.",
    "dda",
    "dd.",
  ],
  // A phone, face down, with the camera at one corner.
  ceo: [
    "=aaaa",
    "aaaaa",
  ],
  "solution-architect": [
    "=dddd.a",
    "=dddd.a",
    "=dddd.a",
  ],
  "hiring-manager": [
    "aaa...",
    "aaaaaa",
    "aaaaaa",
  ],
  // A printed slide: paper with two ruled lines.
  client: [
    "dddddd",
    "d====d",
    "dddddd",
    "d====d",
    "dddddd",
  ],
  "bar-raiser": [
    "..a..",
    "=ddd=",
    "=ddd=",
    "=====",
  ],
};

/** Four panes and a sill one cell wider than the frame. */
export const WINDOW: string[] = [
  ".===================.",
  ".=22222222=22222222=.",
  ".=22222222=22222222=.",
  ".=22222222=22222222=.",
  ".=22222222=22222222=.",
  ".=22222222=22222222=.",
  ".=22222222=22222222=.",
  ".===================.",
  ".=22222222=22222222=.",
  ".=22222222=22222222=.",
  ".=22222222=22222222=.",
  ".=22222222=22222222=.",
  ".=22222222=22222222=.",
  ".=22222222=22222222=.",
  ".===================.",
  "=====================",
];

/** The whiteboard carries the beat track motif: five squares, then two lines. */
export const WHITEBOARD: string[] = [
  "==========================",
  "=222222222222222222222222=",
  "=222222222222222222222222=",
  "=222==22==22==22==22==222=",
  "=222==22==22==22==22==222=",
  "=222222222222222222222222=",
  "=222222222222222222222222=",
  "=222==========22222222222=",
  "=222222222222222222222222=",
  "=222=======22222222222222=",
  "=222222222222222222222222=",
  "=222222222222222222222222=",
  "=222222222222222222222222=",
  "==========================",
  "........=========.........",
];

export const PLANT: string[] = [
  "...gg.g..",
  "..gggggg.",
  ".ggggggg.",
  ".gggggggg",
  "..gggggg.",
  "...gggg..",
  "....=....",
  "..=====..",
  "..33333..",
  "..33333..",
  "..33333..",
  "...333...",
];

/** Behind each seated figure. The figure covers the middle. */
export const CHAIR_BACK: string[] = [
  ".=========.",
  "=333333333=",
  "=333333333=",
  "=333333333=",
  "=333333333=",
  "=333333333=",
  "=333333333=",
  "=333333333=",
  "=333333333=",
];

const TABLE_SPAN = 56;
const row = (char: string, width = TABLE_SPAN) => char.repeat(width);
const legs = () => `..==${".".repeat(TABLE_SPAN - 8)}==..`;

/** The table top, its front edge and apron, and two legs down to the floor. */
export const TABLE: string[] = [
  row("="),
  row("3"),
  row("3"),
  row("3"),
  row("="),
  row("2"),
  row("2"),
  legs(), legs(), legs(), legs(), legs(), legs(), legs(), legs(),
];

/** The learner's chair, seen from behind, in the foreground. */
export const LEARNER_CHAIR: string[] = [
  "....=========....",
  "..==333333333==..",
  ".=3333333333333=.",
  "=333333333333333=",
  "=333333333333333=",
  "=333333333333333=",
  "=333333333333333=",
  "=333333333333333=",
  "=333333333333333=",
  "=================",
  ".......===.......",
  ".......===.......",
];

/** The static sprites, so a test can check every character of each. */
export const SPRITES: Record<string, string[]> = {
  WINDOW, WHITEBOARD, PLANT, CHAIR_BACK, TABLE, LEARNER_CHAIR,
  ...Object.fromEntries(Object.entries(PROPS).map(([slug, rows]) => [`PROP ${slug}`, rows])),
};

/** A grid as mutable rows of characters. */
export type Cells = string[][];

export function toCells(rows: string[]): Cells {
  return rows.map((line) => line.split(""));
}

export function toRows(cells: Cells): string[] {
  return cells.map((line) => line.join(""));
}

/**
 * Paints a sprite onto a grid at (x, y). Transparent cells leave what is
 * under them, and anything past the edge is dropped.
 */
export function stamp(cells: Cells, sprite: string[], x: number, y: number): void {
  sprite.forEach((line, dy) => {
    const target = cells[y + dy];
    if (!target) return;
    for (let dx = 0; dx < line.length; dx += 1) {
      const char = line[dx]!;
      if (char === TRANSPARENT) continue;
      if (x + dx < 0 || x + dx >= target.length) continue;
      target[x + dx] = char;
    }
  });
}

function fillRect(cells: Cells, char: string, x: number, y: number, width: number, height: number): void {
  for (let dy = 0; dy < height; dy += 1) {
    for (let dx = 0; dx < width; dx += 1) cells[y + dy]![x + dx] = char;
  }
}

/** Where the furniture sits, in scene cells. The seats are in room.tsx. */
export const LAYOUT = {
  floorTop: 30,
  window: { x: 5, y: 3 },
  whiteboard: { x: 47, y: 4 },
  plant: { x: 70, y: 19 },
  table: { x: 12, y: 26 },
  learnerChair: { x: 32, y: 36 },
  figureTop: 13,
  chairTop: 17,
  propTop: 27,
} as const;

function buildScene(): string[] {
  const cells: Cells = Array.from({ length: SCENE_HEIGHT }, () => Array<string>(SCENE_WIDTH).fill("w"));
  fillRect(cells, "-", 0, LAYOUT.floorTop, SCENE_WIDTH, 1);
  fillRect(cells, "f", 0, LAYOUT.floorTop + 1, SCENE_WIDTH, SCENE_HEIGHT - LAYOUT.floorTop - 1);
  stamp(cells, WINDOW, LAYOUT.window.x, LAYOUT.window.y);
  stamp(cells, WHITEBOARD, LAYOUT.whiteboard.x, LAYOUT.whiteboard.y);
  stamp(cells, PLANT, LAYOUT.plant.x, LAYOUT.plant.y);
  return toRows(cells);
}

/** The empty room: wall, floor, window, whiteboard and plant. Nobody is seated and the table is not laid. */
export const SCENE: string[] = buildScene();
