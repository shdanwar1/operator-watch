# Operation 3 — Checklist Records and Completion Times

## Outcome
Operators keep the existing checkbox-only experience. Admin → Checklists shows actual shift records and their saved checklists, including when each item was most recently checked.

## Completion times and data safety
- Extend snapshot items with `completedAt`, storing only Berlin-local `HH:mm` or `null`. Generate the value on the server using the existing Berlin clock formatter.
- Checking records the current time; unchecking clears it; rechecking records a new time. Treat missing times in old snapshots as unknown, without backfilling or changing historical records.
- Keep the existing operator mutation and ownership/open-shift checks. Make snapshot writes concurrency-safe across item changes, initialization, and class synchronization so rapid clicks cannot overwrite other progress.
- Preserve immediate checkbox feedback and restore the correct previous item state on failure. Do not display times anywhere on the operator dashboard.

## Admin → Checklists
- Add `/admin/checklists` to the existing admin navigation and shell, with app-specific page metadata.
- Implement only **Checklist Records**, not an editor or a placeholder editing section.
- Default the date filter to today in Berlin. Add an operator filter and a compact list containing only Date, Operator, and Shift Timing.
- Use actual attendance shift start/end values; ongoing shifts show an open end. Filter shifts by their Berlin check-in date, keeping overnight shifts together under their start date.
- Expand a shift to show Start Shift, its saved class checklists, and End Shift with derived completed/total counts.
- Open individual checklists in a read-only detail view using existing admin controls. Preserve stored text, order, class names, teachers, headings, and cancellation status.
- Completed items show their saved time; older completed items show “Time not recorded”; unchecked items show “Not completed” without a time.
- Include concise empty, loading, failure, and missing-historical-data states. Keep the three-column list and long checklist text readable on narrow screens.

## Technical approach
- Keep `shifts.checklists` as the only historical checklist source. No joins to rolling classes or current templates for the records viewer; no read-triggered snapshot creation.
- Add a dedicated admin read function following the existing signed server-session gate. Reject non-admin requests before accessing records, including direct function calls.
- Fetch the selected day's shift snapshots together with only needed fields; expansion uses already-loaded data, avoiding per-shift or per-item requests. Filter operator choices without depending on current class records.
- Use conditional snapshot updates with conflict retries (or an equivalent atomic JSON update) for persistence; protect initialization and class synchronization as well as checkbox writes. No new tables or columns.
- Preserve existing authentication, checkout, class lifecycle, and operator presentation. No polling, realtime, scheduled work, analytics, template editing, or reordering.

## Verification
- Add focused tests for Berlin summer/winter time, check/uncheck/recheck, legacy snapshots, rapid/concurrent changes and rollback, admin authorization, cross-operator denial, Berlin date boundaries, operator filters, and historical template isolation.
- Test record hierarchy, completion-time display, missing data, cancelled classes, and read-only controls.
- Run the full test suite and lint; inspect the platform's automatic type/build checks rather than launch duplicate builds. Distinguish existing lint issues from new ones.
- Attempt the real operator-to-admin flow and desktop/mobile inspection with an available signed-in gate session. Never bypass the PIN gate or invent credentials. If unavailable, report the exact live-verification limitation separately from automated results.

## Explicitly excluded
Operation 4, master checklist editing, item addition/deletion/reordering, historical mutations, analytics, new checklist tables, and background services.