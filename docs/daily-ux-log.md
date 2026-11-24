# Daily operator UX log

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
