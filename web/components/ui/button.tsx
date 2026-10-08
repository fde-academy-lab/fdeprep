/**
 * Buttons. The primary one is inverted, light on dark, so the accent stays a
 * signal for focus and state rather than becoming the colour of every call to
 * action. docs/08 section 3: the accent appears at most twice per screen.
 */
import Link from "next/link";
import type { ComponentProps } from "react";
import { cn } from "./cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "warn";
export type ButtonSize = "sm" | "md" | "lg";

const BASE =
  "inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap " +
  "rounded-control font-medium active:translate-y-px disabled:pointer-events-none " +
  "disabled:opacity-45 aria-disabled:pointer-events-none aria-disabled:opacity-45";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-text text-bg hover:bg-white",
  secondary:
    "border border-border-strong bg-surface-2 text-text hover:border-border-control " +
    "hover:bg-surface-3",
  ghost: "text-text-dim hover:bg-surface-2 hover:text-text",
  danger: "border border-fail/40 text-fail hover:bg-fail-soft",
  /** docs/08 gives warn to degraded mode; the switch that throws it wears it. */
  warn: "border border-warn/50 text-warn hover:bg-warn-soft",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-meta [&_svg]:size-3.5",
  md: "h-8 px-3 text-body [&_svg]:size-4",
  lg: "h-10 px-4 text-body [&_svg]:size-4",
};

export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md",
                            extra?: string): string {
  return cn(BASE, VARIANTS[variant], SIZES[size], extra);
}

export function Button({ variant, size, className, type = "button", ...rest }:
  ComponentProps<"button"> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button type={type} className={buttonClass(variant, size, className)} {...rest} />;
}

export function ButtonLink({ variant, size, className, ...rest }:
  ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <Link className={buttonClass(variant, size, className)} {...rest} />;
}
