# Admin Checklist Records — Compact Table Redesign

## Outcome
Admin → Checklists becomes a compact, table-first records view matching the supplied reference while retaining the existing app styling and read-only checklist detail dialog.

## UI changes
- Keep the compact title, add “View shift checklist records,” and align the existing Date and Operator controls in one responsive row.
- Display only shifts with at least one completed checklist item, ordered by newest check-in first.
- Add a Status column derived from existing checklist completion and open/closed shift data, using existing green, blue, and neutral treatments.
- Keep each shift as an inline expandable table row. The expanded area will contain exactly Shift Start Checklist, Class Checklists, and End of Shift Checklist.
- Present Start and End as compact summary rows, and classes as a dense responsive table with time, class, teacher, type, progress, and the existing View Checklist action.
- Preserve the current historical detail dialog unchanged in behavior and content.

## Scope safeguards
- Change only the Admin Checklists route, its records presentation component, and UI-focused tests.
- Do not change server functions, storage, permissions, checklist snapshots, timestamps, operator UI, checkout, or any other admin page.

## Verification
- Add focused coverage for qualifying-shift filtering, newest-first ordering, derived states, four-column records, and the three expanded groups.
- Verify filters, row expansion, checklist details, and desktop/mobile rendering in the live preview if an admin gate session is available.
- Check changed-file lint, focused tests, TypeScript, and the platform build result.
