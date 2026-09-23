# Remove legacy travel planning and simplify Time to Leave

## Outcome
- Keep one `TIME TO LEAVE` value for the operator’s next shift.
- Remove route details, alternatives, transit labels, persisted travel plans, and travel notifications.
- Reorder the inactive Dashboard to: Next Shift + Time to Leave, Upcoming Shifts, Monthly Hours.
- Make Records start with attendance and end with a compact hours summary.

## Implementation
1. **Replace the travel calculation**
   - Keep the existing authenticated server boundary and existing operator/studio coordinates.
   - Query the VBB journey service once for the next shift’s required arrival time.
   - Read only the first valid door-to-door departure/arrival pair, calculate the duration, and return only the departure time and duration.
   - Do not retain journey legs, modes, stations, line numbers, transfers, alternatives, or maps.
   - Keep the five-minute arrival buffer and show an unobtrusive unavailable state when VBB fails.
   - Prevent duplicate requests for the same next shift during a mounted session; do not poll or persist the response.

2. **Delete the obsolete travel system**
   - Remove the JourneyPlan/DirectPlan model, route ranking/rescheduling, MOTIS fallback, local travel snapshots, transit icons/assets, route-detail UI, and the `operator_travel_plans` write/read paths.
   - Remove Time-to-Leave push jobs and their profile preference while preserving shift-start and check-in notifications.
   - Simplify notification reconciliation and the database due-gate so they depend only on scheduled shifts.
   - Remove obsolete comments, imports, types, and tests/fixtures found by the repository-wide travel audit.

3. **Remove the database model safely**
   - Add one migration that updates `push_dispatch_due()` first, then drops `operator_travel_plans` with its exclusive trigger, indexes, and foreign keys.
   - Preserve already-applied historical migration files; they remain migration history rather than live architecture.
   - Update generated database typings so the removed table cannot be referenced by application code.

4. **Restructure the Dashboard without changing calculations**
   - For the inactive operator view, show the next shift’s day, full date, start/end, class count, and the single Time-to-Leave value.
   - Show up to five later upcoming shifts directly below, with date and start/end only.
   - Move the current-month Worked/Scheduled totals, progress bar, and Day/Night/Weekend breakdown from Records to the Dashboard, reusing `summarizeMonth` unchanged.
   - Preserve the active-shift, check-in, checklist, class, and check-out flows.

5. **Simplify Records presentation**
   - Remove the large monthly overview from the top.
   - Keep month controls, attendance heading/count, responsive table, row expansion, editing, deletion, past-shift entry, and PDF export unchanged.
   - Add one compact bottom summary: Day Hours, Night Hours, Weekend Hours, Total; no progress bar or travel information.

## Verification
- Add focused tests for the minimal VBB response parser/calculation and unavailable responses.
- Verify the Dashboard has one next-shift Time-to-Leave value, at most five later shifts, and no forbidden transit details.
- Verify Records history and existing monthly calculations are unchanged.
- Confirm the database table is gone and repository searches find no obsolete travel-plan, JourneyPlan, DirectPlan, MOTIS, or route-detail references.
- Run the full test suite, TypeScript check, changed-file lint, and production build.
- Live-test operator sign-in as Shad, Dashboard, Records, reload behavior, and browser console; report any data-dependent limitation exactly.
