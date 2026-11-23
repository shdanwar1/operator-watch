# Daily operator UX log

## 2026-11-23 (Europe/Berlin) — Checklists no longer vanish silently when loading fails
Problem: At shift open, if the checklists failed to load (bad studio Wi-Fi), the Start/class/End checklists simply disappeared after a brief pop-up, with no way to retry except reloading the page.
Change: Dashboard shows a "Couldn't load your checklists" card with a Retry button until they load; a failed background refresh keeps the checklists already on screen. Files: src/components/checklist/useShiftChecklists.ts, src/routes/index.tsx.
How to verify (30 seconds): Check in, go offline in dev tools, reload the dashboard data → error card with Retry appears; go online, tap Retry → checklists appear.
Not done / next candidates:
- Show "next unticked item" highlight in each open checklist.
- Stale-tab indicator when the dashboard has been open for hours without refresh.
- Warn before End Shift when class checklists still have unticked items.
- Live class "Now & Next" spotlight under the shift timer.
