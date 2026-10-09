/**
 * The screens and chapters the command palette can jump to. Plain data, icons
 * by name, so the global header and the workspace bar build the same list.
 */
import type { Route } from "next";
import { STAGES, TRACK_NAMES } from "@/lib/problems/vocabulary";
import type { PaletteChapter, PalettePage } from "./command-palette";

export function palettePages(role: "learner" | "faculty" | "admin"): PalettePage[] {
  const pages: PalettePage[] = [
    { href: "/", label: "Home", icon: "home", keywords: "path next up" },
    { href: "/problems", label: "Problems", icon: "problems", keywords: "catalogue list" },
    { href: "/rehearsal", label: "Rehearsal", icon: "rehearsal", keywords: "screen timed mock" },
    { href: "/voice", label: "Voice", icon: "voice", keywords: "speak interview type questions" },
    { href: "/progress", label: "Progress", icon: "progress",
      keywords: "heatmap competencies readiness" },
  ];
  if (role !== "learner") {
    pages.push({ href: "/admin" as Route, label: "Admin", icon: "admin",
                 keywords: "roster submissions import ops cohort stuck calibration panel" });
  }
  return pages;
}

/**
 * The fourteen chapters in the order the stages run, each filed under its
 * stage's name, so typing production finds Guardrails and permissions.
 */
export function paletteChapters(): PaletteChapter[] {
  return STAGES.flatMap((stage) => stage.tracks.map((track) => ({
    track, href: `/chapters/${track}` as Route, label: TRACK_NAMES[track], keywords: stage.name,
  })));
}
