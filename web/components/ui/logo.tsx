/**
 * The mark: three points climbing a path, which is the product in one shape.
 * Drawn for this product; it borrows no one's logo.
 */
import { cn } from "./cn";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn("size-6", className)}>
      <rect x="0.75" y="0.75" width="22.5" height="22.5" rx="6.5"
            className="fill-surface-3 stroke-border-strong" strokeWidth="1.5" />
      <path d="M6 17.25 L11 12.25 L13.5 14.25 L18 7.75" fill="none"
            className="stroke-text-faint" strokeWidth="1.6" strokeLinecap="round"
            strokeLinejoin="round" />
      <circle cx="6" cy="17.25" r="1.9" className="fill-text-dim" />
      <circle cx="11.9" cy="12.9" r="1.9" className="fill-text-dim" />
      <circle cx="18" cy="7.75" r="2.3" className="fill-accent" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-[-0.01em]",
                        className)}>
      <LogoMark />
      <span>FDE Prep</span>
    </span>
  );
}
