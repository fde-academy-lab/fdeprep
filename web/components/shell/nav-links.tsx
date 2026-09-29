"use client";
/**
 * The header's section links. A client component only so it can read the
 * path and mark the section the learner is in.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";
import { cn } from "@/components/ui/cn";

export interface NavItem {
  href: Route;
  label: string;
  /** Other path prefixes that belong to this section. */
  also?: string[];
}

function isActive(pathname: string, item: NavItem): boolean {
  const prefixes = [item.href as string, ...(item.also ?? [])];
  return prefixes.some((prefix) =>
    prefix === "/" ? pathname === "/" : pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function NavLinks({ items, underline = true }: { items: NavItem[]; underline?: boolean }) {
  const pathname = usePathname() ?? "/";
  return (
    <nav aria-label="Sections" className="flex items-center gap-1">
      {items.map((item) => {
        const active = isActive(pathname, item);
        return (
          <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined}
                className={cn(
                  "relative rounded-control px-2.5 py-1.5 font-medium",
                  active ? "text-text" : "text-text-dim hover:bg-surface-2 hover:text-text",
                  active && !underline && "bg-surface-2")}>
            {item.label}
            {active && underline ? (
              <span aria-hidden
                    className="absolute inset-x-2.5 -bottom-3 h-0.5 rounded-full bg-accent" />
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
