/**
 * Difficulty as a four-step meter plus its word.
 *
 * Monochrome on purpose. The state colours mean pass, fail, warning and
 * running, and a green Easy or a red Extreme would spend them on something
 * that is neither. The position comes from the policy module, so this file
 * draws a number rather than deciding anything about a tier.
 */
import { difficultyLabel, ladderPosition, type Difficulty } from "@/lib/policy/tiers";
import { cn } from "./cn";

const STEPS = 4;

export function DifficultyMeter({ difficulty, label = true, className }: {
  difficulty: Difficulty; label?: boolean; className?: string;
}) {
  const position = ladderPosition(difficulty);
  const word = difficultyLabel(difficulty);
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-text-dim", className)}
          title={label ? undefined : word}>
      <svg width="15" height="12" viewBox="0 0 15 12" aria-hidden className="shrink-0">
        {Array.from({ length: STEPS }, (_, i) => (
          <rect key={i} x={i * 4} y={9 - i * 3} width="3" height={3 + i * 3} rx="1"
                className={i < position ? "fill-text" : "fill-border-strong"} />
        ))}
      </svg>
      {label ? <span>{word}</span> : <span className="sr-only">{word}</span>}
    </span>
  );
}
