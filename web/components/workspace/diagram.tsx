"use client";
/**
 * The system diagram, drawn from the problem's diagram block.
 *
 * The grammar is the explainer one: one hue per subject, nodes with an icon, a
 * bold title and a short subtitle, dashed arrows that move in the direction
 * the data flows, numbered when order matters, and a callout that says what
 * the picture proves. Adapted for a dark canvas and for a pane that may be
 * narrow: nodes are HTML so their text wraps instead of shrinking, arrows are
 * an SVG layer measured from where the nodes actually landed, and when the
 * pane is too narrow for the columns the picture turns on its side.
 *
 * Every arrow carries a number and its label sits in the list under the
 * picture. A label drawn on the arrow collides with a node the first time a
 * pane is dragged narrower; a number never does.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRightFromLine, Bot, Cpu, Database, FileText, Layers, Maximize2, Server, ShieldCheck,
  Split, UserRound, Wrench, X, type LucideIcon,
} from "lucide-react";
import type { Diagram, DiagramEdge, EdgeTone, NodeKind, Tone } from "@/lib/problems/kit";
import { cn } from "@/components/ui/cn";
import { renderCode, withoutCodeMarks } from "@/components/ui/code";

const KIND_ICON: Record<NodeKind, LucideIcon> = {
  actor: UserRound, model: Cpu, agent: Bot, tool: Wrench, store: Database, service: Server,
  decision: Split, output: ArrowRightFromLine, doc: FileText, queue: Layers, guard: ShieldCheck,
};

/** Whole class strings, so Tailwind can see every one of them. */
// Opaque tints, mixed into the surface, so an edge routed behind a node stays
// behind it instead of showing through the label.
const TONE: Record<Tone, { box: string; chip: string }> = {
  blue: { box: "border-tone-blue/45 bg-[color-mix(in_srgb,var(--color-tone-blue)_7%,var(--color-surface))]", chip: "bg-tone-blue/15 text-tone-blue" },
  green: { box: "border-tone-green/45 bg-[color-mix(in_srgb,var(--color-tone-green)_7%,var(--color-surface))]", chip: "bg-tone-green/15 text-tone-green" },
  purple: { box: "border-tone-purple/45 bg-[color-mix(in_srgb,var(--color-tone-purple)_7%,var(--color-surface))]", chip: "bg-tone-purple/15 text-tone-purple" },
  teal: { box: "border-tone-teal/45 bg-[color-mix(in_srgb,var(--color-tone-teal)_7%,var(--color-surface))]", chip: "bg-tone-teal/15 text-tone-teal" },
  orange: { box: "border-tone-orange/45 bg-[color-mix(in_srgb,var(--color-tone-orange)_7%,var(--color-surface))]", chip: "bg-tone-orange/15 text-tone-orange" },
  pink: { box: "border-tone-pink/45 bg-[color-mix(in_srgb,var(--color-tone-pink)_7%,var(--color-surface))]", chip: "bg-tone-pink/15 text-tone-pink" },
  neutral: { box: "border-border-strong bg-surface-2", chip: "bg-surface-3 text-text-dim" },
};

const EDGE: Record<EdgeTone, { stroke: string; fill: string; badge: string; moving: boolean }> = {
  default: { stroke: "stroke-text-faint", fill: "fill-text-faint", badge: "border-border-control text-text-dim", moving: true },
  danger: { stroke: "stroke-fail", fill: "fill-fail", badge: "border-fail/70 text-fail", moving: true },
  success: { stroke: "stroke-pass", fill: "fill-pass", badge: "border-pass/70 text-pass", moving: true },
  muted: { stroke: "stroke-border-control", fill: "fill-border-control", badge: "border-border-strong text-text-faint", moving: false },
};

interface Placed { id: string; col: number; row: number }

/** Grid positions: the author's `at` where given, the next free cell otherwise. */
export function layout(diagram: Diagram, sideways: boolean): { placed: Placed[]; cols: number; rows: number } {
  const taken = new Set<string>();
  const placed: Placed[] = [];
  for (const node of diagram.nodes) {
    if (node.at) {
      placed.push({ id: node.id, col: node.at[0], row: node.at[1] });
      taken.add(`${node.at[0]}:${node.at[1]}`);
    }
  }
  const width = Math.max(1, ...placed.map((p) => p.col + 1), Math.min(4, diagram.nodes.length));
  let cursor = 0;
  for (const node of diagram.nodes) {
    if (node.at) continue;
    while (taken.has(`${cursor % width}:${Math.floor(cursor / width)}`)) cursor++;
    placed.push({ id: node.id, col: cursor % width, row: Math.floor(cursor / width) });
    taken.add(`${cursor % width}:${Math.floor(cursor / width)}`);
  }
  const flip = sideways !== (diagram.direction === "tb");
  const oriented = flip ? placed.map((p) => ({ id: p.id, col: p.row, row: p.col })) : placed;
  return {
    placed: oriented,
    cols: Math.max(1, ...oriented.map((p) => p.col + 1)),
    rows: Math.max(1, ...oriented.map((p) => p.row + 1)),
  };
}

interface Drawn { d: string; mid: [number, number]; edge: DiagramEdge; number: number }

type Point = [number, number];

function cubic(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
          a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]];
}

/** How far a point is from the nearest node, zero when it is on one. */
function clearance([x, y]: Point, nodes: DOMRect[]): number {
  let nearest = Infinity;
  for (const n of nodes) {
    const dx = Math.max(n.left - x, 0, x - n.right);
    const dy = Math.max(n.top - y, 0, y - n.bottom);
    nearest = Math.min(nearest, Math.hypot(dx, dy));
  }
  return nearest;
}

/**
 * Where along its own curve an edge's number goes: the middle when the middle
 * is clear of every node, and otherwise the point on the curve furthest from
 * any node, so a number never sits on top of a label.
 */
function badgeAt(curve: [Point, Point, Point, Point], nodes: DOMRect[]): Point {
  const middle = cubic(...curve, 0.5);
  if (clearance(middle, nodes) >= 12) return middle;
  let best = middle, room = clearance(middle, nodes);
  for (let step = 1; step <= 18; step++) {
    const t = 0.05 * step;
    const point = cubic(...curve, t);
    const here = clearance(point, nodes);
    if (here > room + 0.5) { best = point; room = here; }
  }
  return best;
}

function route(edges: DiagramEdge[], boxes: Map<string, DOMRect>, origin: DOMRect): Drawn[] {
  const pairs = new Set(edges.map((e) => `${e.from}>${e.to}`));
  // Nodes, and each number once it is placed, so two numbers never stack.
  const obstacles = [...boxes.values()].map((r) =>
    new DOMRect(r.left - origin.left, r.top - origin.top, r.width, r.height));
  return edges.flatMap((edge, index) => {
    const a = boxes.get(edge.from);
    const b = boxes.get(edge.to);
    if (!a || !b) return [];
    const ax = a.left - origin.left, ay = a.top - origin.top;
    const bx = b.left - origin.left, by = b.top - origin.top;
    const acx = ax + a.width / 2, acy = ay + a.height / 2;
    const bcx = bx + b.width / 2, bcy = by + b.height / 2;
    const dx = bcx - acx, dy = bcy - acy;
    // Two arrows between the same pair would draw over each other; each one
    // steps aside by the same amount in opposite directions.
    const shift = pairs.has(`${edge.to}>${edge.from}`) ? (edge.from < edge.to ? -11 : 11) : 0;

    let curve: [Point, Point, Point, Point];
    if (Math.abs(dx) >= Math.abs(dy) * 0.9) {
      const sx = dx > 0 ? ax + a.width : ax, sy = acy + shift;
      const tx = dx > 0 ? bx - 3 : bx + b.width + 3, ty = bcy + shift;
      const k = Math.max(20, Math.abs(tx - sx) / 2);
      const s = dx > 0 ? 1 : -1;
      curve = [[sx, sy], [sx + s * k, sy], [tx - s * k, ty], [tx, ty]];
    } else {
      const sx = acx + shift, sy = dy > 0 ? ay + a.height : ay;
      const tx = bcx + shift, ty = dy > 0 ? by - 3 : by + b.height + 3;
      const k = Math.max(16, Math.abs(ty - sy) / 2);
      const s = dy > 0 ? 1 : -1;
      curve = [[sx, sy], [sx, sy + s * k], [tx, ty - s * k], [tx, ty]];
    }
    const [p0, p1, p2, p3] = curve;
    const d = `M${p0[0]},${p0[1]} C${p1[0]},${p1[1]} ${p2[0]},${p2[1]} ${p3[0]},${p3[1]}`;
    const mid = badgeAt(curve, obstacles);
    obstacles.push(new DOMRect(mid[0] - 10, mid[1] - 10, 20, 20));
    return [{ d, mid, edge, number: index + 1 }];
  });
}

/** The narrowest a node gets before the picture scrolls instead of squeezing. */
const MIN_NODE = 148;

export function DiagramView({ diagram, className, large = false }: {
  diagram: Diagram; className?: string; large?: boolean;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(0);
  const [drawn, setDrawn] = useState<Drawn[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const markerBase = useId().replace(/:/g, "");

  const natural = useMemo(() => layout(diagram, false), [diagram]);
  // Turn the picture on its side when a column would be narrower than a node
  // can be and still hold a title.
  const turned = useMemo(() => layout(diagram, true), [diagram]);
  // Turn only when turning makes the picture narrower; a turned picture with
  // as many columns just trades one squeeze for another.
  const sideways = available > 0 && natural.cols > turned.cols &&
    available / natural.cols < (large ? 130 : 150);
  const grid = useMemo(() => layout(diagram, sideways), [diagram, sideways]);
  const byId = useMemo(() => new Map(diagram.nodes.map((n) => [n.id, n])), [diagram]);

  // Measured in the diagram's own coordinates. A thumbnail scales the whole
  // picture with a CSS transform, and getBoundingClientRect reports the scaled
  // size, so without dividing it out the edges would be scaled twice.
  const measure = useCallback(() => {
    const el = container.current;
    if (!el || !el.offsetWidth) return;
    const outer = el.getBoundingClientRect();
    const scale = outer.width / el.offsetWidth || 1;
    const local = (r: DOMRect) => new DOMRect((r.left - outer.left) / scale,
                                              (r.top - outer.top) / scale,
                                              r.width / scale, r.height / scale);
    const boxes = new Map<string, DOMRect>();
    el.querySelectorAll<HTMLElement>("[data-node]").forEach((node) => {
      boxes.set(node.dataset["node"]!, local(node.getBoundingClientRect()));
    });
    setSize({ w: el.offsetWidth, h: el.offsetHeight });
    setDrawn(route(diagram.edges, boxes, new DOMRect(0, 0, el.offsetWidth, el.offsetHeight)));
  }, [diagram.edges]);

  useLayoutEffect(() => {
    setAvailable(scroller.current?.clientWidth ?? 0);
    measure();
  }, [measure, grid]);
  useEffect(() => {
    const el = container.current;
    const outer = scroller.current;
    if (!el || !outer || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      setAvailable(outer.clientWidth);
      measure();
    });
    observer.observe(el);
    observer.observe(outer);
    return () => observer.disconnect();
  }, [measure]);

  const gap = grid.cols > 3 ? "gap-x-8" : "gap-x-12";

  return (
    <div className={cn("min-w-0", className)}>
      {/* Below a readable column width the picture scrolls sideways inside
          its card, because a squeezed column breaks labels mid-word. */}
      <div ref={scroller} className="-mx-1 overflow-x-auto px-1 pb-1">
      <div ref={container} className="relative"
           style={{ minWidth: grid.cols * MIN_NODE + (grid.cols - 1) * (grid.cols > 3 ? 32 : 48) }}>
        <div className={cn("grid items-center gap-y-7", gap)}
             style={{ gridTemplateColumns: `repeat(${grid.cols}, minmax(0, 1fr))` }}>
          {grid.placed.map((place) => {
            const node = byId.get(place.id)!;
            const tone = TONE[node.tone] ?? TONE.neutral;
            const Icon = KIND_ICON[node.kind] ?? Server;
            return (
              <div key={node.id} data-node={node.id}
                   style={{ gridColumn: place.col + 1, gridRow: place.row + 1 }}
                   className={cn("relative z-10 flex min-w-0 items-start gap-2.5 rounded-[10px]",
                                 "border px-2.5 py-2", tone.box)}>
                <span className={cn("mt-px grid size-7 shrink-0 place-items-center rounded-md",
                                    tone.chip)}>
                  <Icon aria-hidden className="size-4" strokeWidth={1.9} />
                </span>
                <span className="min-w-0">
                  <span className="block break-words text-body font-semibold leading-tight
                                   text-text">
                    {renderCode(node.label)}
                  </span>
                  {node.sub ? (
                    <span className="mt-0.5 block break-words text-meta leading-snug
                                     text-text-dim">
                      {renderCode(node.sub)}
                    </span>
                  ) : null}
                </span>
              </div>
            );
          })}
        </div>

        <svg aria-hidden width={size.w} height={size.h}
             className="pointer-events-none absolute inset-0 z-0 overflow-visible">
          <defs>
            {(Object.keys(EDGE) as EdgeTone[]).map((tone) => (
              <marker key={tone} id={`${markerBase}-${tone}`} viewBox="0 0 10 10" refX="8.5"
                      refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" className={EDGE[tone].fill} />
              </marker>
            ))}
          </defs>
          {drawn.map(({ d, edge, number }) => (
            <path key={`${edge.from}-${edge.to}-${number}`} d={d} fill="none" strokeWidth={1.8}
                  markerEnd={`url(#${markerBase}-${edge.tone})`}
                  className={cn(EDGE[edge.tone].stroke,
                                EDGE[edge.tone].moving ? "flow-dash" : "[stroke-dasharray:3_4]")} />
          ))}
        </svg>

        {drawn.map(({ mid, edge, number }) => (
          <span key={`badge-${number}`} aria-hidden
                style={{ left: mid[0], top: mid[1] }}
                className={cn("absolute z-20 grid size-5 -translate-x-1/2 -translate-y-1/2",
                              "place-items-center rounded-full border bg-bg font-mono text-[11px]",
                              "font-semibold", EDGE[edge.tone].badge)}>
            {number}
          </span>
        ))}
      </div>
      </div>

      <ol className="mt-5 grid gap-x-6 gap-y-1.5 text-meta sm:grid-cols-2">
        {diagram.edges.map((edge, index) => (
          <li key={`${edge.from}-${edge.to}-${index}`} className="flex min-w-0 items-baseline gap-2">
            <span className={cn("grid size-5 shrink-0 translate-y-[3px] place-items-center",
                                "rounded-full border font-mono text-[11px] font-semibold",
                                EDGE[edge.tone].badge)}>
              {index + 1}
            </span>
            <span className="min-w-0">
              <span className={cn("font-medium",
                                  edge.tone === "danger" ? "text-fail"
                                    : edge.tone === "success" ? "text-pass" : "text-text")}>
                {renderCode(edge.label ?? "then")}
              </span>
              <span className="text-text-faint">
                {" "}{renderCode(byId.get(edge.from)?.label ?? "")} to{" "}
                {renderCode(byId.get(edge.to)?.label ?? "")}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Title, picture and callout, with a way to open the picture full size. */
export function DiagramFigure({ diagram }: { diagram: Diagram }) {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <figure className="rounded-panel border border-border bg-surface px-4 pb-4 pt-3">
      <div className="mb-4 flex items-start justify-between gap-3">
        <figcaption className="text-lead font-semibold leading-snug text-text">
          {renderCode(diagram.title)}
        </figcaption>
        <button type="button" onClick={() => dialog.current?.showModal()}
                aria-label="Open the diagram full size"
                className="grid size-7 shrink-0 place-items-center rounded-control text-text-faint
                           hover:bg-surface-2 hover:text-text">
          <Maximize2 aria-hidden className="size-4" />
        </button>
      </div>
      <DiagramView diagram={diagram} />
      {diagram.caption ? (
        <p className="mt-4 rounded-control border-l-2 border-text-faint bg-surface-2 px-3 py-2
                      font-medium text-text">
          {renderCode(diagram.caption)}
        </p>
      ) : null}

      <dialog ref={dialog} aria-label={withoutCodeMarks(diagram.title)}
              onClick={(event) => { if (event.target === dialog.current) dialog.current?.close(); }}
              className="m-auto w-[min(1180px,calc(100vw-2rem))] max-w-none rounded-panel border
                         border-border-strong bg-surface p-0 text-text backdrop:bg-bg/80
                         backdrop:backdrop-blur-[2px] open:rise-in">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <p className="text-lead font-semibold">{renderCode(diagram.title)}</p>
          <button type="button" onClick={() => dialog.current?.close()} aria-label="Close"
                  className="grid size-8 place-items-center rounded-control text-text-dim
                             hover:bg-surface-2 hover:text-text">
            <X aria-hidden className="size-4" />
          </button>
        </div>
        <div className="relative max-h-[80vh] overflow-auto p-6">
          <DiagramView diagram={diagram} large />
          {diagram.caption ? (
            <p className="mt-5 rounded-control border-l-2 border-text-faint bg-surface-2 px-3 py-2
                          font-medium">
              {renderCode(diagram.caption)}
            </p>
          ) : null}
        </div>
      </dialog>
    </figure>
  );
}

/**
 * The diagram at its natural size, scaled down to fit, for a preview beside
 * other content. A diagram squeezed into a narrow column instead breaks its
 * labels mid-word; scaled, it keeps its layout and reads as a picture of the
 * problem.
 */
export function DiagramThumbnail({ diagram, naturalWidth = 600, className }: {
  diagram: Diagram; naturalWidth?: number; className?: string;
}) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ scale: number; height: number } | null>(null);

  useLayoutEffect(() => {
    const measure = () => {
      if (!outer.current || !inner.current) return;
      const scale = Math.min(1, outer.current.clientWidth / naturalWidth);
      setFit({ scale, height: inner.current.offsetHeight * scale });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    if (outer.current) observer.observe(outer.current);
    if (inner.current) observer.observe(inner.current);
    return () => observer.disconnect();
  }, [naturalWidth]);

  return (
    <div ref={outer} className={cn("relative w-full overflow-hidden", className)}
         style={{ height: fit ? fit.height : undefined }}>
      <div ref={inner} className="origin-top-left [&_ol]:hidden"
           style={{ width: naturalWidth, transform: fit ? `scale(${fit.scale})` : undefined }}>
        <DiagramView diagram={diagram} />
      </div>
    </div>
  );
}
