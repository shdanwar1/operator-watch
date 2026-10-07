# Auto check-out: always on, runs at each shift's end time

## What changes for operators
- The "Auto check out at end of shift" switch is removed from Profile. Auto check-out is on for every operator.
- At the exact scheduled end time of each shift, the app checks that shift's End Shift checklist:
  - Fully completed → the shift is checked out with check-out time = scheduled end, and the shift's information is saved.
  - Not completed → nothing happens. The shift stays open and the operator checks out by hand, as today.
- Old shifts left open are ignored. Only shifts that end now are checked.

## What check-out saves (manual and automatic)
Every check-out saves the class list for the shift: each class's name and teacher name, plus the class count, and marks the scheduled shift as completed. Manual check-out keeps doing this; auto check-out does exactly the same.

## How it works
- The list of shift end times is the existing scheduled shifts (date + end time, Berlin time, overnight and daylight-saving handled). No new table.
- The existing every-minute timer looks only at shifts whose scheduled end fell in the last few minutes (a small catch-up window so a delayed tick is not missed). Shifts that ended earlier are never revisited.
- Check-out uses the existing single check-out path, so a shift is never checked out twice (if the operator already checked out by hand, nothing happens).

## Technical details
- `src/routes/profile.tsx`: remove the Auto check-out switch and its queries. Delete `src/lib/auto-checkout.functions.ts`. Leave any stored `prefs.autoCheckout` untouched but unused.
- `src/domain/auto-checkout.ts`: drop `autoCheckoutEnabled` and the "+10 min after late completion" rule. New pure rule `autoCheckoutDue(scheduledEnd, now, windowMs)` → true when `scheduledEnd <= now < scheduledEnd + window` (window 5 min); checklist complete at that moment → close at scheduledEnd.
- `src/lib/auto-checkout.server.ts`: query `scheduled_shifts` whose end falls in the window (today/yesterday dates, filtered in code by `scheduledEndAt`), then their open `shifts` rows; remove the 500-row scan of all open shifts and the operator prefs lookup. Keep `classesForShift` (name + teacher from the shift's class snapshot joined to calendar classes / DMC directory) and `closeShift`.
- Migration: simplify the auto check-out clause in `push_dispatch_due()` to "a non-cancelled scheduled shift ended within the last 5 minutes and has an open check-in", so the timer stays idle otherwise.
- Tests: update `auto-checkout.test.ts` — due at end, due within window, not due before end, not due after window (old shift), incomplete checklist, already checked out, overnight, DST.

## Not changed
Manual check-out, checklists, notifications, Time to Leave, Calendar, Records layout, Studio Display, admin.
