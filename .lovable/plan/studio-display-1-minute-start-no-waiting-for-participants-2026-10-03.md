# Studio Display — +1 minute start, no "Waiting for Participants"

## What changes on the studio screen
- The countdown before class counts to **scheduled start + 1 minute** (10:00 class: 09:45 shows 16:00, 10:00 shows 01:00).
- The big 10 → 1 countdown runs 10:00:50–10:00:59; 0 lands at exactly 10:01:00.
- The blue "Waiting for Participants" screen is removed completely.
- At 10:01:00 the screen goes straight to green "Start the Class" (shown 30 seconds, as today), then "Time Remaining".
- Time Remaining always counts to the **real** end: 44:00 at 10:01 for a 45-minute class, 59:00 for a 60-minute class.
- 5-minute, 1-minute, final 30 seconds, end and Q&A stay tied to the real end (10:40 / 10:44 / 10:44:30 / 10:45).
- Class name/teacher and icebreaker windows follow the new countdown target.
- Stored class times, duration, timetable and everything else stay unchanged.

## Technical details
- `src/lib/studio-display.ts` `computeStage`: add `DISPLAY_START_OFFSET_MS = 60_000`; `displayStart = start + offset`; "before"/"countdown10" use `displayStart - now`; countdown10 shows `ceil` seconds, with 0 handled by the instant switch to green. Delete the `joining` phase and `JOINING_MS`; `startclass` = `displayStart <= now < displayStart + 30s`; end/warnings keep `end = start + duration`. Remove `"joining"` from `StagePhase` and `STAGE_COLORS.blue` if unused.
- `src/routes/display.tsx`: compute `untilStart` from the display start (export a small `resolveDisplayStart` helper) for the class-info cutoff and pre-class window; remove the `joining` branch.
- `resolveClassStart` and its running-window guess stay on the real start (no stored-data change).
- Everything derived from the current clock, so refresh/reopen at any moment shows the right stage; same logic for all three window sizes.
- Add unit tests for `computeStage` covering the full acceptance sequence for 45- and 60-minute classes (16:00, 06:00, 01:00, 10…1, green at 10:01:00, 44:00, 05:00, 01:00, 00:30, end) plus open-at 10:00:30 / 10:01:05 cases.
