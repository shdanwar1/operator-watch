# Ballet BARRE to CENTER transition refinement

Only the Barre-to-Center transition changes. Workout, every other Ballet stage, and every other timer stage stay exactly as they are.

## 1. The main timer stays the focus during the 30-second Center announcement
- The big "CENTER" word goes away. The large timer (20:00, 19:59, ...) stays in its normal size and position.
- For those 30 seconds the small label above the timer says **SWITCH TO CENTER** instead of "TIME REMAINING". After 30 seconds it goes back to "TIME REMAINING".

## 2. More noticeable switch animation
- During the final minute of Barre the white selector still slides from BARRE to CENTER, and now it also:
  - glows softly and pulses, and the whole switch grows slightly while it moves
  - the CENTER label brightens as the selector gets closer
- When it reaches CENTER at 20:00 there is a short "pop" (a quick scale bounce and a glow flash), then it settles.
- Users who turn off motion in their system settings get the plain slide, with no pulse or pop.

## 3. Colour changes gradually during the final minute
- The background fades smoothly from green to indigo over the last minute of Barre (21:00 to 20:00), following the switch. At 20:00 it is fully indigo, as now.
- The 5-minute yellow, 1-minute orange and final-30-second red stages are unchanged.

## Technical details
- `src/lib/studio-display.ts` `computeStage`: during the Barre lead minute (progress between 0 and 1, phase `live`), `bgColor` becomes `color-mix(in oklab, <green> , var(--sd-center) <progress×100>%)`. When `centerIntro` is true, `label` = "Switch to Center". Fields stay the same; still computed only from remaining time (no saved state, no extra timer).
- `src/routes/display.tsx`: remove the `sd-center-word` branch so the normal timer always renders; always show the label (which now carries the intro text). Add a class on the switch while `0 < switchProgress < 1` and a one-off pop class while `centerIntro`.
- `src/styles.css`: glow/pulse keyframes for the moving switch, pop keyframes for arrival, `prefers-reduced-motion` fallback; drop the unused `.sd-center-word` rule.
- Update `studio-display-stage.test.ts`: intro label is "Switch to Center" for exactly 30 s; background is a green/indigo mix at 10:39:30 and pure green before 10:39:00; existing Workout-unchanged test stays.
- Check in the 480×220 floating window with screenshots at 21:00, 20:30, 20:00 and 19:30.
