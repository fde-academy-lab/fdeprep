/**
 * The approach map: how to think about the problem, as a goal and the
 * branches that lead to it. A mind map drawn as a tree, because a radial map
 * needs a square canvas and this one lives in a pane that is taller than it
 * is wide. It never contains the answer; the author's branches are questions
 * to answer in order.
 */
import { Target } from "lucide-react";
import type { Approach } from "@/lib/problems/kit";
import { cn } from "@/components/ui/cn";

/** One hue per branch, from the diagram palette, so each branch reads as its own subject. */
const BRANCH = [
  { rail: "bg-tone-blue", dot: "border-tone-blue", text: "text-tone-blue" },
  { rail: "bg-tone-green", dot: "border-tone-green", text: "text-tone-green" },
  { rail: "bg-tone-purple", dot: "border-tone-purple", text: "text-tone-purple" },
  { rail: "bg-tone-orange", dot: "border-tone-orange", text: "text-tone-orange" },
  { rail: "bg-tone-teal", dot: "border-tone-teal", text: "text-tone-teal" },
] as const;

export function ApproachMap({ approach }: { approach: Approach }) {
  return (
    <div>
      <div className="flex items-center gap-3 rounded-panel border border-border-strong
                      bg-surface-2 px-3.5 py-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-full border
                         border-border-control bg-surface-3 text-text">
          <Target aria-hidden className="size-4" strokeWidth={1.9} />
        </span>
        <p className="font-semibold leading-snug text-text">{approach.goal}</p>
      </div>

      <ol className="relative ml-[15px] mt-1 border-l border-border-strong pt-1">
        {approach.branches.map((branch, index) => {
          const tone = BRANCH[index % BRANCH.length]!;
          return (
            <li key={branch.label} className="relative pb-4 pl-6 pt-3 last:pb-1">
              <span aria-hidden className="absolute -left-px top-[22px] h-px w-5 bg-border-strong" />
              <span aria-hidden
                    className={cn("absolute left-[18px] top-[17px] size-[11px] rounded-full border-2",
                                  "bg-bg", tone.dot)} />
              <div className="pl-4">
                <p className="font-semibold leading-snug text-text">
                  <span className={cn("mr-1.5 font-mono text-meta", tone.text)}>{index + 1}</span>
                  {branch.label}
                </p>
                {branch.detail ? (
                  <p className="mt-1 text-text-dim">{branch.detail}</p>
                ) : null}
                {branch.leaves.length ? (
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {branch.leaves.map((leaf) => (
                      <li key={leaf}
                          className="rounded-full border border-border-strong bg-surface px-2.5 py-0.5
                                     text-meta text-text-dim">
                        {leaf}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
