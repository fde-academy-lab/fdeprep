# FDE Prep: design system

An original visual identity for a dense, dark developer tool. Everything here is permissively licensed and safe to ship in an internal product.

**Amended 29 September 2026** with the interface revamp. The changes are marked in place; the tokens in `web/app/globals.css` are the source of truth and this document describes them.

---

## 1. Licensing position, stated once

Build an original interface. Do not reproduce another product's stylesheet, markup, component code or copy, and do not target a platform vendor's design language.

Specifically on the Apple question: Apple's Human Interface Guidelines describe Apple platforms, and the SF typeface family is licensed for use on Apple platforms. There is no published Apple design skill for Claude Code, and reproducing Apple's design language in a web application is both a licensing question and the wrong target. This product is a dense keyboard-driven workspace, not an iOS app. The systems below are the open equivalents and they are better suited.

---

## 2. Type

Three faces maximum. All are open licensed.

| Role | Face | Licence | Why |
|---|---|---|---|
| Interface | Geist | SIL Open Font Licence 1.1 | Built for interfaces, tabular figures, and a sharper voice than the default every generated interface reaches for |
| Code and data | Geist Mono | SIL Open Font Licence 1.1 | Pairs with the interface face, clear zero, tabular by design |

**Amended 29 September 2026:** Inter and JetBrains Mono were replaced by Geist and Geist Mono, one family for both roles. Both come from the `geist` npm package (1.7.2), which loads them through `next/font/local`, so they are self-hosted and a build needs no font network.

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
--bg              #0A0B0D    page
--surface         #101216    panels, table rows
--surface-2       #16191E    raised, hover
--surface-3       #1D2127    selected row, pressed
--border          #23272E    every divider
--border-strong   #30353D    panel and chip outlines
--border-control  #5C636E    inputs and checkboxes, 3:1 against bg and surface
--text            #ECEEF2    primary, 15.2:1 on surface-2
--text-dim        #A0A7B2    secondary, 7.3:1 on surface-2
--text-faint      #858C98    meta, 5.2:1 on surface-2

--accent          #6E97F2    focus rings, selected state, links, progress
--accent-solid    #3A68CF    a filled accent with white text, 5.2:1

--pass            #46C25A
--fail            #F26B63
--warn            #D9A441    stretching, degraded mode, attempted
--info            #6E97F2    queued, running (the accent's hue)
```

**Amended 29 September 2026:** the ramp gained a third surface and two border weights, the faint text moved up to pass 4.5:1 on every surface, and saturation came down below 80 percent. The primary button is inverted (light fill, dark text) rather than accent-filled, so the accent stays a signal for focus and state.

Diagram tones are content, not chrome. The system diagram and the approach map give each subject a hue from the explainer grammar (`--tone-blue`, `-green`, `-purple`, `-teal`, `-orange`, `-pink`, `-neutral`). They appear inside those two components and nowhere in the interface around them, where the one-accent rule holds. Syntax colours are content in the same sense: they appear in the editor and in a Python code block inside a brief, a contract or a walkthrough, and both read one list in `web/lib/ui/syntax.ts`. Amended 30 September 2026.

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
| Lucide | ISC | The whole interface, from `lucide-react` 1.48.0. Consistent 24px grid, 1.75px stroke in this product, very large set. It carries no brand marks, so the sign-in button uses a generic sign-in glyph rather than a drawn GitHub logo. |
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

Use the Motion library for anything beyond a CSS transition. Do not add a second animation library. As of 29 September 2026 nothing needs it: the only motion in the product is CSS (a 180ms rise for a new coach line or a floating layer, the moving dashes on a diagram edge, and a skeleton's pulse).

The one continuous animation is a diagram edge: dashed, moving in the direction the data flows, 1.1s per cycle. It means "this is a flow" and nothing else, and `prefers-reduced-motion` stops it.

Rule for the whole product: motion is a signal, so spending it on decoration wastes it. If an animation does not tell the user something changed, delete it.

---

## 6. Density

This is a tool, not a landing page.

| Surface | Rule |
|---|---|
| Tables | 36px row height, 12px horizontal padding. Twenty problem rows visible without scrolling at 900px viewport height. |
| Cards | Only where a thing is a single object a learner acts on: the continue panel, a scenario, a capstone build. Lists stay lists. |
| Panels | 16px padding, 1px border, 12px radius, no shadow. Elevation is a step up the surface ramp. Shadows on a near-black background produce mud; the one exception is a floating layer (the command palette, a menu), which needs to read as above the page. |
| Radius | One scale: panels 12px, controls 8px, keys 4px, chips a full pill. |
| Empty states | One sentence naming the next action, and a button. A single icon in a small square is the only decoration. |

**Amended 29 September 2026:** cards moved from "the Next Up strip only" to the rule above, because the home screen's primary action and a problem's scenario are objects, and drawing them as table rows hid them.

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
