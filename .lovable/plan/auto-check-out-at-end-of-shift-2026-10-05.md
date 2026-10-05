# Auto check-out at end of shift

## What the operator sees
- Profile: one new on/off switch, "Auto check out at end of shift", between Google Calendar and Notifications. On by default. No extra text.
- Nothing else changes. Completing the End Shift checklist never checks out on its own straight away; manual "Hold for check out" works as now.

## Rules (run by the server, not the phone)
For each open shift (checked in, not checked out) whose operator has the switch on:
- End Shift checklist not fully complete → do nothing.
- Completed at or before the scheduled end → check out at the scheduled end, with check-out time = scheduled end.
- Completed after the scheduled end → check out 10 minutes after completion, with check-out time = completion + 10 min.
- Already checked out (manually or by an earlier run) → do nothing.

"Completed at" = the latest completion time among the End Shift items in the shift's saved checklist (already stored per item). Scheduled end = the scheduled shift's date + end time in Berlin time, rolled to the next day when end is earlier than start (overnight), so daylight-saving is handled.

## Records
Auto check-out writes the same fields as manual check-out: check-out time, the shift's class list (each class name + teacher, from the classes the shift's checklist already tracks), class count, and marks the scheduled shift completed. No new class-recording system.

## Technical details
- Setting stored in existing `operators.prefs` as `autoCheckout` (missing = on). New `getMyAutoCheckout` / `setMyAutoCheckout` server functions; Profile toggle uses the existing Switch component.
- Extract the core of `checkOutShift` (End-checklist gate, `update ... where check_out_at is null`, scheduled-shift completion) into a shared server helper `closeShift(shiftId, checkOutAt, classes)`. Manual check-out keeps calling it with "now"; auto check-out calls it with the computed time. The conditional update makes it idempotent — repeated runs or a manual check-out first produce exactly one check-out.
- Class list for auto check-out: built server-side from the shift's class snapshot (`checklists.classes`) joined to `calendar_classes` → `dmc_classes` / `dmc_instructors` for name and teacher, same shape the dashboard sends today.
- Runs inside the existing every-minute timer (`/api/public/hooks/push-dispatch`) — no new scheduler. `push_dispatch_due()` gets one extra cheap clause: true when any open shift exists whose scheduled end has passed, so the timer stays a no-op when nothing is open. Each run handles a small bounded batch.
- No new tables. One migration only to update `push_dispatch_due()`.
- Tests (pure helper `autoCheckoutAt(shift, scheduled, prefs, now)`): before-end, after-end (+10), incomplete, switch off, completed exactly at end, overnight end, DST day; plus idempotency of the close step and class name/teacher mapping for a multi-class shift.

## Not changed
Start Shift, class/End checklists behaviour, notifications, Time to Leave, Calendar, Studio Display, Records layout, admin.
