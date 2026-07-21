# Studio Display Redesign

Rework `/display` (and its shared state logic) into a full-viewport, auto-staged broadcast timer that scales with the window and transitions colors/labels automatically from Class Start + Duration.

## Scope

- `src/lib/studio-display.ts` — extend phase logic to 7 stages
- `src/routes/display.tsx` — full rewrite of the presentation view
- `src/components/StudioDisplayPanel.tsx` — preview mirrors new stage label/color (inputs unchanged: start time, duration, notes)
- `src/styles.css` — add smooth color-fade + subtle pulse/blink keyframes

No changes to backend, auth, check-in gating, or BroadcastChannel sync.

## Stage Timeline (computed from `startTime` + `durationMin`)

Let `S` = scheduled start, `W = S + 60s` (warm-up ends / class begins), `E = W + durationMin*60s` (class end — duration counts from warm-up end so the teaching block matches the entered minutes).

| Stage | Window | Background | Label | Timer |
|---|---|---|---|---|
| 1 Before | now < S | Black | "Class starts in" | Countdown to S |
| 2 Warm-up | S ≤ now < W | Blue | "Wait for Participants" | Counts up 00:00 → 01:00 |
| 3 Live | W ≤ now < E−5m | Green | "Class Live" | Counts down to E |
| 4 5-min | E−5m ≤ now < E−1m | Yellow | "5 Minutes Remaining" | Counts down to E |
| 5 1-min | E−1m ≤ now < E−30s | Orange | "1 Minute Remaining" | Counts down to E |
| 6 Final | E−30s ≤ now < E | Red (gentle pulse + timer blink) | "30 Seconds Remaining" | Counts down to E |
| 7 Complete | now ≥ E | Black | "Class Complete" (or "Waiting for Next Class" if a next start exists) | 00:00 |

Note: this changes the current single "duration = start→end" model. The entered duration becomes the *teaching* length; total display runtime = duration + 1 min warm-up. Confirm if you'd rather have duration include the warm-up minute.

## Responsive Layout

- Root: `fixed inset-0` flex column, `justify-center items-center`, single centered content block (label + timer + optional notes) so nothing drifts when notes appear/disappear.
- Fluid type via `clamp()`:
  - Label: `clamp(1rem, 2.2vw, 2rem)`, uppercase, tracked
  - Timer: `clamp(6rem, 22vmin, 28rem)` monospaced tabular-nums
  - Notes: `clamp(1.25rem, 2.2vw, 2.25rem)`, `max-w-[80ch]`, centered, wraps naturally, auto-shrinks one step past ~200 chars
- Uses `vmin`/`clamp` so it looks right on phone → 4K → ultrawide, portrait or landscape, in or out of fullscreen.
- Notes block reserves no fixed space — the outer flex keeps the whole block centered whether notes are empty or long.

## Animations (Apple-style, subtle)

- Background: CSS `transition: background-color 600ms ease` on the root; stage color swaps fade smoothly.
- Label/notes: fade+slide (150ms) on text change via a `key`-swap wrapper.
- Stage 6: root gets a slow `hg-pulse`-style background scale/opacity pulse (1s), timer gets a `blink` opacity animation (1s). Both stop the instant stage changes.
- No flashes, no layout jumps.

## Contrast / Legibility

- All backgrounds paired with white foreground; Yellow stage uses near-black text for AA contrast.
- Notes get a subtle backdrop scrim only on Yellow to keep text readable.

## Technical Notes

- Replace `computeTimer` return with `{ phase, label, bg, fg, timerMs, direction: "down" | "up", blink }` — one source of truth consumed by both `/display` and the control panel preview.
- Ticker stays at 1s; final-stage blink is pure CSS so it stays smooth between ticks.
- Control panel preview card shows the same label + color chip so the operator sees what's on-air.
- No new deps.

## Out of Scope

- Multi-class scheduling / "next class" queue (the "Waiting for Next Class" copy is shown only if such data already exists; otherwise "Class Complete").
- Any change to who can open the display or the check-in gating.
