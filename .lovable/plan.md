# Studio Display — Visual Redesign (no behaviour change)

A pure presentation-layer redesign. `computeStage()`, timing thresholds, sync, icebreaker selection, Q&A duration and popup behaviour stay byte-identical.

## 1. Current screen inventory (derived from code)

Rendering order in `src/routes/display.tsx` → `DisplayScreen`: ticks every 250ms, measures the surface with a `ResizeObserver` (`useAspect`), applies `stage.bgColor` on a full-bleed layer with a 10s background-colour transition, and text colour `text-white` / `text-neutral-900` from `stage.fg`.

| # | Component | Trigger | Content | Dynamic | Colour | Responsive |
|---|---|---|---|---|---|---|
| 1 | `ClassInfoStage` | class name/teacher present, phase `before`, >5 min to start (`CLASS_INFO_CUTOFF_MS`) | "Up next", class name, teacher, start time, `N MIN`, "Class starts in" + MM:SS | timer each tick | black / white | 2-col grid when `ratio >= 1.35`, else stacked |
| 2 | `PreClassStage` | phase `before` and ≤5 min (`PRECLASS_WINDOW_MS`) | "Class starts in", MM:SS, "Starts at HH:MM", one icebreaker line | timer each tick; icebreaker swaps on the 15s wall-clock slot with `sd-fade` | black / white | CSS container query at `23/20`: landscape = timer ǀ divider ǀ tip; portrait = timer / h-divider / tip |
| 3 | `CountdownCinematic` | phase `countdown10` (last 10s) | single number 10→1 | number re-keys each second, `sd-countdown` animation | black / white | one centred element, `55vmin` |
| 4 | `MainStage` + `TimerBlock` | phases `joining`, `startclass`, `live`, `warn5`, `warn1`, `final30` | `stage.label` + MM:SS countdown to class end | label re-fades on stage change; `sd-blink` on final30; `sd-pulse-bg` on the background layer | blue / green / green / yellow(dark text) / orange / red | landscape+notes = timer ǀ notes panel; else stacked centred |
| 5 | Notes (`Notes` / `NotesPanel`) | non-empty notes during `MainStage` | full multiline notes, `whitespace-pre-wrap` | static | inherits stage fg | landscape: right panel with left hairline border; portrait: below timer, centred |
| 6 | `QAStage` + `CircularTimer` | phase `qa` (5 min after end) | ring progress, "Class Complete"/"Q&A"/"Q & A", clock glyph, MM:SS, "Questions & Discussion" footer in full mode | ring dash animates 900ms, timer each tick | black / white | `min(w,h)`: <360 minimal, <600 compact, else full |
| 7 | Idle | phase `idle` (after Q&A) | label "Waiting for Next Class"; `TimerBlock` hides the digits | none | black / white | centred |
| 8 | `StudioDisplayPanel` (control) | `/studio-display` | Upcoming/Current pill switch, time, duration, notes, live preview + status line | preview re-renders every 1s | app theme | 7fr/3fr on lg, stacked below |

## 2. Proposed design per screen

Shared intent: the display becomes a *stage*, not a UI. Type and negative space carry everything; no cards, icons or gradients on the display itself.

**Screen 1 — Upcoming (quiet / informational).** Editorial split. Left: hairline rule above a `0.36em`-tracked "UP NEXT" eyebrow, then class name at the largest weight-600 optical size with tight `-0.03em` tracking, teacher one step down in 70% opacity, then a metadata row (`HH:MM · 60 MIN`) separated by hairline dots instead of gaps. Right: countdown baseline-aligned to the class name, label above it, digits at 60% opacity-white "shell" weight so the name and the clock share dominance rather than competing. Portrait: same order stacked, left-aligned block then countdown, divider hairline between. New timer enters with a 400ms fade only on stage change.

**Screen 2 — Pre-class (welcoming / anticipatory).** Keep the exact container-query split and the 50% divider. Refinements: timer becomes the single anchor — larger, lighter weight, tabular, with the "CLASS STARTS IN" eyebrow shrunk and pushed further above by generous space, and "Starts at HH:MM" demoted to a 40%-opacity footnote sitting on its own baseline. Icebreaker loses the "Tips to break the ice:" prefix styling as a label-plus-quote run and instead becomes a left-aligned pull-quote: small tracked kicker line ("ICE BREAKER") above, then the sentence in a lighter, larger, generously leading-loose face, no quote marks in portrait. Divider gets a vertical gradient fade (opaque centre, transparent ends) so it reads as light rather than a border. Icebreaker transition: 15s swap keeps its exact timing, upgraded to a 500ms fade + 6px rise.

**Screen 3 — 10-second countdown (dramatic).** Full-bleed, single glyph, no labels. Number scales to `min(62vmin, 80vh)`, ultralight weight for a cinematic film-leader feel, tracking `-0.06em`. Each digit enters with a scale 1.06→1 plus opacity 0→1 over 420ms and leaves nothing behind; a faint radial vignette (pure black-on-black, no colour) focuses the centre. Same numbers, same 1s cadence.

**Screen 4 — Class running (focused → urgent).** One template, six tonal treatments. Constant: eyebrow label at top of the timer block, timer in a single scale rhythm, no chrome. Colour refinement: each state background gets a very subtle vertical tonal shift of its own hue (e.g. green top slightly lighter than bottom) — same semantic colour, no multi-hue gradient. `warn5` keeps dark text. Urgency ramps through type, not clutter: `warn1` tightens the label tracking and raises label opacity; `final30` keeps the existing blink + background pulse but the blink moves from whole-block opacity to a controlled 1s luminance breath on the digits only, so the number never disappears at a distance.

**Screen 5 — Notes.** Landscape: keep the right column, replace the hard left border with a hairline that fades at both ends, and set notes in a wider measure (`44ch`) with `1.5` leading and 85% opacity — deliberate secondary text, never boxed. Portrait: notes sit below the timer separated by the same fading hairline, centred, `52ch`, no truncation, `whitespace-pre-wrap` preserved.

**Screen 6 — Q&A (calm).** Thinner precision ring (track 0.4, progress 0.9 stroke), drop the glow shadow for a clean stroke, keep the 900ms dash transition and the three responsive modes. Inside the ring: label, then timer, with the clock glyph reduced and moved to sit beside the label rather than between label and timer, so the vertical rhythm is label → time. Full mode keeps the "Questions & Discussion" footer, pinned lower with tighter tracking.

**Screen 7 — Idle (minimal / ready).** Centred "WAITING FOR NEXT CLASS" in the small tracked label style at 45% opacity, with a single slow-breathing 6px dot above it (8s cycle) to signal the screen is alive, and nothing else.

**Screen 8 — Control panel: OUT OF SCOPE.** `src/routes/studio-display.tsx` and `src/components/StudioDisplayPanel.tsx` are left exactly as they are. Only `StudioDisplayPreview.tsx` is restyled, because it must mirror the redesigned display.

## 3. Shared design system

- **Type — SF Pro everywhere:** every Studio Display screen (all stages plus the control panel and preview) uses the SF Pro family via the existing `--font-sans` / `--font-display` tokens in `src/styles.css` (`-apple-system, BlinkMacSystemFont, "SF Pro Display"/"SF Pro Text", …`). The current `font-mono` on the timers is dropped — digits switch to SF Pro Display with `font-variant-numeric: tabular-nums` and `font-feature-settings: "tnum", "ss01"` so they stay perfectly column-aligned while gaining SF's cleaner numerals. A `--font-display-numeric` token is added for the large clock digits so all timers share one face. Three roles: display numerals (SF Pro Display, tabular, tight tracking, weight 300–600 by state), tracked uppercase labels (SF Pro Text, `0.3–0.38em`, 45–80% opacity), and body/notes (SF Pro Text, regular, loose leading). All sizes stay `clamp()`-driven off `vmin`/container units.
- **Spacing:** one scale, `clamp()` steps tied to `vmin` so every screen breathes identically at 500×1000 and 1920×1080.
- **Colour:** `STAGE_COLORS` values unchanged as the semantic source; only a subtle same-hue tonal overlay is added at the surface level. Foreground stays `stage.fg`.
- **Dividers:** always 1px, always fading at the ends, never a full-strength border.
- **Timer styling:** one shared timer component API (label + digits + optional footnote) reused by Upcoming, Pre-class and Main so the digits never drift between screens.
- **Transitions:** 240ms fade for label swaps, 420–500ms for content changes, existing 10s background transition and 900ms ring transition untouched. No idle decorative motion beyond the idle dot.
- **Responsive:** orientation continues to come from the container query (`23/20`) for pre-class and the measured `ratio >= 1.35` for the other stages; portrait always stacks TIMER → DIVIDER → TEXT.

## 4. Implementation map

- `src/routes/display.tsx` — restyle `ClassInfoStage`, `PreClassStage`, `PreClassTimer`, `IcebreakerLine`, `CountdownCinematic`, `MainStage`, `TimerBlock`, `Notes`, `NotesPanel`, `QAStage`, `CircularTimer`; add a small shared `StageLabel`/`TimerDigits` pair inside the same file. No changes to `DisplayScreen`'s stage selection logic.
- `src/styles.css` — refine `sd-*` keyframes (countdown, fade, blink), add fading-divider and idle-dot utilities; keep the `sd-preclass-*` container-query rules and their `23/20` breakpoint.
- `src/components/StudioDisplayPreview.tsx` — mirror the new display styling so preview and display stay identical.
- Untouched: `src/components/StudioDisplayPanel.tsx`, `src/routes/studio-display.tsx`, `src/lib/studio-display.ts`, `src/lib/icebreakers.ts`, `src/hooks/useStudioDisplay.ts`, database, APIs.

## 5. Regression safeguards

- No edits to `computeStage`, `resolveClassStart`, `formatMMSS`, thresholds, `QA_MS`, `CLASS_INFO_CUTOFF_MS`, or `PRECLASS_WINDOW_MS`.
- Stage → component mapping in `DisplayScreen` stays exactly as-is, so every existing state still renders.
- Icebreaker selection (`pickIcebreaker`) and its wall-clock-aligned 15s scheduler are untouched; only the fade styling changes.
- Notes stay full-text, `whitespace-pre-wrap`, no truncation, in both orientations.
- `useStudioDisplay`, BroadcastChannel sync, URL overrides and the live class-display resync effect are untouched.
- Verification with a Playwright pass at 1280×800, 1920×1080, 900×900, 670×1886 and 500×1000, screenshotting each stage by driving the start time, confirming portrait never renders side-by-side.
