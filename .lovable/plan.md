# Daily-view dashboard priority (presentation only)

## Goal
Replace the current phase-based “No shift soon” logic with a simple **today-first daily priority** on the Dashboard. This is a presentation/priority change only — no changes to shift calculation, Google Calendar sync, the Time to Leave algorithm, notifications, attendance logic, or the active/checked-in flow.

## Priority (non-active, profile-complete)

```
Active (checked in)?        → ActiveShiftPanel (UNCHANGED — check-out fingerprint)
  ↓ no
Shift TODAY?                → Today card: time + classes + Time to Leave + check-in fingerprint
  ↓ no
Shift TOMORROW?             → "No shift today" + Tomorrow · start–end time
  ↓ no
Shift later (≤28d)?         → "No shift soon" + "Next shift · <Weekday>" or "Next shift · <Month Day>"
  ↓ no
No shifts at all            → "No shifts booked"
```

Profile-incomplete gate (`LockedFeatureCard`) is preserved as-is — it stays the first gate after `active`, unchanged.

## State details

1. **Shift TODAY** (a `DisplayShift` whose `startAt` is the same calendar day as `now`, not checked in)
   - Main card. Eyebrow + range once: `Today · 6:00 PM → 10:00 PM`.
   - Class count line (`N classes`) when present.
   - **Time to Leave** card (`variant="embedded"`) shown for **every** today shift — no longer gated by the 6h leave window. Still gated by `prefs.showTimeToLeave` and a present home address.
   - **Check-in fingerprint** (`Hold to check in`) shown for today shifts only. Reuses the existing `HoldButton` + unscheduled-confirm dialog + late-warning logic.
   - Status label is never “No shift soon” for a today shift: `Ready to check in` (within 1h / ongoing), `Travel` (1–6h), else `Today`.

2. **No shift today, shift TOMORROW**
   - Card: `No shift today` header, then `Tomorrow · 6:00 PM → 10:00 PM`.
   - No Time to Leave, no check-in fingerprint, no class count.

3. **No shift today/tomorrow, shift later**
   - Card: `No shift soon` header, then `Next shift · Monday` (within 7 days) or `Next shift · September 3` (further out).
   - No times, no class count, no Time to Leave.

4. **No shifts at all** (no scheduled rows / no upcoming instances)
   - Card: `No shifts booked`.

## Implementation (all in `src/routes/index.tsx`)

- Derive `todayShift`, `tomorrowShift`, `nextShift` from the existing `upcomingDisplay` (`buildDisplayShifts`) using same-calendar-day comparison (a `sameDay(a,b)` helper already exists via `formatShiftRange`).
- Replace the non-active render branch (≈ lines 628–692) with the priority switch above.
- Add small presentational components: `TodayShiftCard`, `NoShiftTodayCard`, `NoShiftSoonCard`, `NoShiftsBookedCard`.
- `TodayShiftCard` reuses the existing `TimeToLeaveCard` (embedded) and the existing `HoldButton` + confirm dialog. To avoid the duplicated “Next scheduled shift” line, add a `hideShiftInfo` flag to `CheckInPanel` (or inline the fingerprint) so the shift range lives only in the card header.
- Remove the **Upcoming shifts** list from the dashboard and delete the now-unused `UpcomingShifts` component. The Calendar page remains the place to see the full schedule.
- The `showTravel` / `phase`-based detail switch is removed; `phase` is kept only for the today-card status label.

## Non-changes
- `shiftPhase`, `LEAVE_WINDOW_MS`, `CHECK_IN_WINDOW_MS`, `resolveCheckInTarget`, `buildDisplayShifts`, `TimeToLeaveCard` internals, push notifications, `ActiveShiftPanel`, the profile-incomplete gate, and the Calendar page are all untouched.

## Verification
- `tsgo` typecheck + build OK.
- Playwright (mobile viewport): today-shift, tomorrow-shift, later-shift, and no-shifts scenarios render the right card with no duplicated sections and no console errors.
