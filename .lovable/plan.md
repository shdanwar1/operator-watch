Pre-check-in Dashboard states

Only the not-yet-checked-in Dashboard changes. Checked-in view, shift logic, attendance, notifications, Time to Leave, checklists and navigation stay as they are.

## The rule (based on the next shift that hasn't ended)

```text
now < start - 1h            -> NORMAL DASHBOARD (exactly as today)
start - 1h <= now < start   -> CHECK-IN WINDOW
start <= now < end          -> LATE CHECK-IN
now >= end                  -> that shift is closed; the next shift decides the state
```

## State 1 — Normal Dashboard
Unchanged: Next shift + Leave at, Upcoming, Monthly hours, and the current floating hold button at the bottom.

## State 2 — Check-in window (matches uploaded screenshot 02)
Full-screen takeover replacing the normal Dashboard content:
- Green dot + "Check-in open"
- "Shift starts in" + large live countdown in HH:MM:SS (01:00:00 at the start of the window, ticking every second)
- Large centered existing hold-to-check-in control ("Hold to clock in"), green ring tint
- Bottom card: "Friday, Sep 25", time range, class count, and "Leave at" value on the right

## State 3 — Late check-in (matches uploaded screenshot 03)
- Amber dot + "Check in now"
- "Started" + large amber "0 min ago" / "15 min ago" / "1h ago" (whole hours show "1h ago", mixed shows "1h 15m ago")
- Same hold control with amber ring tint
- Bottom card: day, time range, class count (no Leave at)
- Stays until the shift's scheduled end; at the end time it disappears automatically.

Holding the button in states 2 and 3 runs the existing check-in for that scheduled shift (no "unscheduled shift" confirmation, since a scheduled shift is open). The existing late-attendance note stays.

## Technical details
- New pure helper `preCheckInState(next, now)` in `src/lib/shift-phase.ts` returning `normal | window | late` using exact 1h boundaries and `endAt` exclusivity; unit tests for 12:59, 13:00, 13:59, 14:00, 21:29, 21:30.
- `src/routes/index.tsx` inactive branch: pick the state from `nextDisplay`; render a new `CheckInTakeover` component for window/late, otherwise the current `InactiveDashboard` + floating `CheckInPanel` untouched. The takeover reuses `HoldButton` (larger size, tone) and the existing `checkIn` handler; target is `nextDisplay`'s first segment, so it works even though `resolveCheckInTarget` is not changed.
- Ensure the page clock ticks every second while in the check-in window (current tick kept otherwise).
- Profile-incomplete lock card behaviour is kept (takeover shows the lock message instead of the hold control).
- Verify with tests, typecheck and build.
