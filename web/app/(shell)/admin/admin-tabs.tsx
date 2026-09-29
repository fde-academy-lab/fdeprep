"use client";
import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { cn } from "@/components/ui/cn";

/** The admin sections as tabs, marking the one in view. */
export function AdminTabs({ tabs }: { tabs: Array<{ href: string; label: string }> }) {
  const pathname = usePathname() ?? "";
  return (
    <nav aria-label="Admin sections" className="flex gap-1 overflow-x-auto border-b border-border">
      {tabs.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link key={tab.href} href={tab.href as Route} aria-current={active ? "page" : undefined}
                className={cn("-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 font-medium",
                              active ? "border-accent text-text"
                                : "border-transparent text-text-dim hover:text-text")}>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
