# FDE Prep: design system

An original visual identity for a dense, dark developer tool. Everything here is permissively licensed and safe to ship in an internal product.

---

## 1. Licensing position, stated once

Build an original interface. Do not reproduce another product's stylesheet, markup, component code or copy, and do not target a platform vendor's design language.

Specifically on the Apple question: Apple's Human Interface Guidelines describe Apple platforms, and the SF typeface family is licensed for use on Apple platforms. There is no published Apple design skill for Claude Code, and reproducing Apple's design language in a web application is both a licensing question and the wrong target. This product is a dense keyboard-driven workspace, not an iOS app. The systems below are the open equivalents and they are better suited.

---

## 2. Type

Three faces maximum. All are open licensed.

| Role | Face | Licence | Why |
|---|---|---|---|
| Interface | Inter | SIL Open Font Licence 1.1 | Designed for screen UI at small sizes, very wide weight and feature coverage, tabular figures for tables |
| Code and data | JetBrains Mono | SIL Open Font Licence 1.1 | High x-height, clear zero, designed for long reading of code |
| Display, optional | Geist or IBM Plex Sans | SIL Open Font Licence 1.1 | Only if the marketing surface needs a voice distinct from the workspace |

Self-host the fonts. Do not link to a font CDN, because it adds a third-party request on every page and the workspace is used for long sessions.

Enable `font-feature-settings: "tnum" 1` on every table and every numeric readout. Figures that change width while a timer runs are the single most common reason a dashboard feels unstable.

### Scale

Six sizes, no more. A seventh size is almost always a hierarchy problem being solved with type.

```
12px  meta, table secondary, timestamps
14px  body, table primary, code
16px  section lead
20px  screen title
28px  question prompt in the Voice Screen
40px  the clock, and nothing else
```

Line height 1.5 for prose, 1.4 for tables, 1.6 for code.

---

## 3. Colour

Near-black base. One accent. Four state colours that mean exactly one thing each and are never used decoratively.

```
--bg            #0B0C0E    page
--surface       #131519    panels, table rows
--surface-2     #1A1D23    raised, editor gutter
--border        #24282F    every divider
--text          #E6E9EF    primary
--text-dim      #9AA3B0    secondary
--text-faint    #5C6470    disabled, dimmed anchors

--accent        #4F8EF7    focus rings, selected state, active beat

--pass          #3FB950
--fail          #F85149
--warn          #D29922    stretching, degraded mode
--info          #58A6FF    queued, running
```

Rules:
- Colour never carries meaning alone. Every state pairs with a glyph or a word, because roughly one in twelve men has a colour vision deficiency and a red and green pass/fail column is unreadable to them.
- Contrast floor is 4.5:1 for text and 3:1 for interface boundaries. Check it, do not assume it.
- The accent appears at most twice per screen.

### Light theme

Build it, do not design it separately. Invert the ramp, keep the same state hues at adjusted lightness, verify contrast again. A learner in a bright room with no light theme will use a browser extension that breaks the layout instead.

---

## 4. Icons

| Set | Licence | Use |
|---|---|---|
| Lucide | ISC | The whole interface. Consistent 24px grid, 1.5px stroke, very large set. |
| Phosphor | MIT | Only if Lucide lacks something specific, and then match the stroke weight |

One set per screen. Two icon families in one interface reads as unfinished even when nobody can say why.

Icons are 16px in tables and 20px everywhere else. Never scale a stroke icon above 24px; it thins out and looks broken.

---

## 5. Motion

| Element | Duration | Easing |
|---|---|---|
| Hover, focus, small state change | 120ms | ease-out |
| Panel, drawer, modal | 180ms | cubic-bezier(0.2, 0, 0, 1) |
| The Voice Screen pace band | continuous, no transition on colour change | the change is the signal, so it must be instant |
| Results appearing in the output pane | none | animated results read as latency |

Respect `prefers-reduced-motion` by reducing every duration to zero rather than by removing the state change.

Use the Motion library for anything beyond a CSS transition. Do not add a second animation library.

Rule for the whole product: motion is a signal, so spending it on decoration wastes it. If an animation does not tell the user something changed, delete it.

---

## 6. Density

This is a tool, not a landing page.

| Surface | Rule |
|---|---|
| Tables | 36px row height, 12px horizontal padding. Twenty problem rows visible without scrolling at 900px viewport height. |
| Cards | Only on the roadmap Next Up strip. Nowhere else. |
| Panels | 16px padding, 1px border, no shadow. Shadows on a near-black background produce mud. |
| Empty states | One sentence naming the next action, and a button. No illustration. |

---

## 7. Components to build, and what to build them on

| Layer | Choice | Licence |
|---|---|---|
| Primitives | Radix UI | MIT. Accessible dialog, popover, tabs, tooltip, select, with keyboard and focus handling already correct. |
| Styling | Tailwind | MIT |
| Component base | shadcn/ui, copied into the repo and then edited | MIT. It is source you own, not a dependency you track. |
| Editor | CodeMirror 6 | MIT |
| Charts, if any | Recharts | MIT |
| Animation | Motion | MIT |

Do not install a component library that owns your markup. Every component in this product needs editing, because the workspace and the cockpit are not standard shapes.

---

## 8. Accessibility floor

Non-negotiable, and cheap if done from the start.

- Every interactive element reachable and operable by keyboard, with a visible focus ring in the accent colour.
- The code workspace is usable with the editor never trapping focus. `Escape` leaves the editor.
- Every state change announced to assistive technology through a live region: run complete, verdict, cap reached.
- The Voice Screen cockpit has a non-visual equivalent: beat transitions and nudges announced, and the pace band state readable as text.
- No information conveyed by colour alone, anywhere.

---

## 9. The Voice Screen cockpit

The cockpit has its own stricter rules in `docs/07-VOICE-SCREEN.md` section 3. They override anything here where they conflict. The short version: five live instruments, one primary, nothing moves except the pace band and the mic level, no number longer than three characters, and no transcript on screen while the learner is speaking.
