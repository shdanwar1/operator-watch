# Daily operator UX log

## 2026-11-28 (Europe/Berlin) — Records check-in/out: quick adjustments and Now
Problem: Correcting a worked shift's check-in or check-out on a phone required fiddling with a combined date-time picker; there was no quick way to nudge the minutes or use the current time.
Change: Both Records editors now use separate large date and native time inputs, 44px −15/−5/+5/+15 buttons, and Now. Midnight adjustments also move the date. Existing save, ownership, and stored-value behavior is unchanged. Files: src/components/form/TimeField.tsx, src/components/form/LocalDateTimeField.tsx, src/components/record/AttendanceSection.tsx, src/domain/time-entry.ts (+test).
How to verify (60 seconds): At 390 px open Records → expand a shift → Edit → tap +5 under Check out, or Now under Check in. The visible time updates immediately; Save keeps the same shift and classes.
Not done / next candidates:
- Edit forms as bottom sheet with sticky Save on phones; discard-changes prompt.
- Notes auto-growing textarea and clearer inline validation.

## 2026-11-25 (Europe/Berlin) — Calendar shift times: quick ±5/±15 buttons and duration
Problem: Correcting a shift's start or end on a phone meant fiddling with the native time wheel; there was no way to see the resulting length.
Change: New shared TimeField (native picker + 44px −15/−5/+5/+15 buttons) and pure time-entry helpers; Calendar shift dialog shows the duration ("1 h 15 min", "+1" overnight). Files: src/domain/time-entry.ts (+test), src/components/form/TimeField.tsx, src/routes/calendar.tsx.
How to verify (60 seconds): At 390 px open Calendar → tap a shift → tap +15 on End → time and duration update; set End before Start → "ends next day (+1)".
Not done / next candidates:
- Records check-in/out (datetime-local) to use TimeField with "Now".
- Edit forms as bottom sheet with sticky Save on phones; discard-changes prompt.

## 2026-11-24 (Europe/Berlin) — Check-out names class checklists left unticked
Problem: At End Shift, operators could check out without noticing a class checklist still had unticked items.
Change: A quiet note above "Hold to check out" lists each non-cancelled class (name + start time) with unticked items; it does not block check-out. Files: src/domain/checklists.ts, src/routes/index.tsx, checklist-ui.test.ts.
How to verify (30 seconds): Check in with a class, leave one class item unticked, scroll to check-out → note names that class; tick it → note disappears.
Not done / next candidates:
- Stale-tab indicator when the dashboard has been open for hours without refresh.
- Live class "Now & Next" spotlight under the shift timer.

## 2026-11-24 (Europe/Berlin) — Next unticked checklist item is highlighted
Problem: Mid-shift, operators had to scan each checklist to find where they left off.
Change: The first unticked item in every open (editable) checklist gets a soft accent bar and tint; moves as items are ticked. Files: src/domain/checklists.ts, src/components/checklist/ChecklistPanel.tsx, ChecklistItem.tsx, checklist-ui.test.ts.
How to verify (30 seconds): Check in, open Start Shift checklist, tick the first item → highlight moves to the second.
Not done / next candidates:
- Warn before End Shift when class checklists still have unticked items.
- Stale-tab indicator when the dashboard has been open for hours without refresh.
- Live class "Now & Next" spotlight under the shift timer.

## 2026-11-23 (Europe/Berlin) — Checklists no longer vanish silently when loading fails
Problem: At shift open, if the checklists failed to load (bad studio Wi-Fi), the Start/class/End checklists simply disappeared after a brief pop-up, with no way to retry except reloading the page.
Change: Dashboard shows a "Couldn't load your checklists" card with a Retry button until they load; a failed background refresh keeps the checklists already on screen. Files: src/components/checklist/useShiftChecklists.ts, src/routes/index.tsx.
How to verify (30 seconds): Check in, go offline in dev tools, reload the dashboard data → error card with Retry appears; go online, tap Retry → checklists appear.
Not done / next candidates:
- Show "next unticked item" highlight in each open checklist.
- Stale-tab indicator when the dashboard has been open for hours without refresh.
- Warn before End Shift when class checklists still have unticked items.
- Live class "Now & Next" spotlight under the shift timer.

## 2026-11-25 (Europe/Berlin) — Checklist progress bars stop shouting
Problem: Completed checklists kept a full-width solid green line under the heading, which read like a card border rather than a finished list; untouched lists showed an empty dark trough.
Change: The bar is gone once every item is ticked (the green "✓ 27 / 27" heading already says it) and gone before you tick anything; while in progress it is a 2px hairline instead of a 4px track. Applies to start, class and end checklists, card and inline layouts.
Files: src/components/checklist/ChecklistPanel.tsx.
How to verify (30 seconds): Open a shift with a class checklist — untouched list shows no bar, ticking one item brings a slim line, finishing it removes the line and leaves the green check.
Not done / next candidates:
- Stale-tab indicator when the dashboard has been open for hours without refresh.
- Live class "Now & Next" spotlight under the shift timer.
