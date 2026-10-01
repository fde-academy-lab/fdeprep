/**
 * The screens the command palette can jump to. Plain data, icons by name, so
 * the global header and the workspace bar build the same list.
 */
import type { Route } from "next";
import type { PalettePage } from "./command-palette";

export function palettePages(role: "learner" | "faculty" | "admin"): PalettePage[] {
  const pages: PalettePage[] = [
    { href: "/", label: "Home", icon: "home", keywords: "journey roadmap next up" },
    { href: "/problems", label: "All problems", icon: "problems", keywords: "catalogue list" },
    { href: "/rehearsal", label: "Rehearsal", icon: "rehearsal", keywords: "screen timed mock" },
    { href: "/voice", label: "Voice practice", icon: "voice", keywords: "speak interview type questions" },
    { href: "/progress", label: "Progress", icon: "progress",
      keywords: "heatmap competencies readiness" },
  ];
  if (role !== "learner") {
    pages.push({ href: "/admin/roster" as Route, label: "Faculty admin", icon: "admin",
                 keywords: "roster submissions import ops" });
  }
  return pages;
}
