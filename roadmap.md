# Timetable update
- [x] Shared time grid, Berlin clock, preserved boundaries
- [x] Shared admin/operator view and authenticated read access
- [x] Navigation and focused tests
- [x] Verify tests, preview and automatic build results

Validation: 169 tests passed; automatic build OK; isolated desktop/narrow grid verified. Live signed-in data checks require a gate session.

# Operation 3 — Checklist records and completion times
- [x] Preserve existing snapshots; add server-generated Berlin HH:mm completion times with safe concurrent writes.
- [x] Add authorized, read-only admin checklist records with date/operator filters and snapshot details.
- [x] Test timestamps, concurrency, authorization, historical isolation, and record presentation.
- [x] Automated verification: 218 tests pass, changed-file lint passes, automatic build OK. Full-project lint has 1333 pre-existing/unrelated findings.
- [ ] Live operator/admin and responsive flow verification blocked: configured SITE_PASSWORD rejected by the real unlock form; no authenticated session. Independent production/typecheck commands not run (platform-managed checks).
- [x] Keep template editing, analytics, and background services out of scope.

# Admin Checklist Records UI redesign
- [x] Filter the records overview to shifts with completed checklist activity and sort newest first.
- [x] Build the compact four-column shift table and three-group inline expansion.
- [x] Preserve filters and historical checklist detail behavior.
- [x] Verify focused tests, changed-file lint, TypeScript, and automatic build status.
- [ ] Live desktop/mobile admin verification remains blocked by the existing unlock gate rejecting the configured access value.

## Checklist rapid-click reliability fix
- [x] Atomic per-item save in the database (no more oversized request that caused "Bad Request")
- [x] Client queue coalesces superseded clicks, auto-retries once, reconciles instead of locking
- [x] Live verified: 8 rapid ticks + triple toggle persisted after refresh, no error toast

## Daily optimization — duplicate check-in
- [x] Check-in is now idempotent for unscheduled shifts too (returns the existing open shift instead of creating a second one)
- [x] Database index prevents two open unscheduled shifts for one operator
- [x] Live verified as Shad: four simultaneous check-ins produced one shift; test row removed

## Daily optimization — theme startup warning
- [x] Removed the hydration mismatch the saved dark/light theme caused on every page load
- [x] Deleted the unused duplicate copy of the theme startup snippet
- [x] Verified: 236 tests, typecheck clean; live light + dark load and operator sign-in with no console errors

## Remove route planning; restructure Dashboard and Records
- [x] Audit travel-routing dependencies and isolate the remaining Time to Leave calculation.
- [x] Remove route planning, persistence, background work, obsolete code, assets, tests, and database table.
- [x] Restructure Dashboard with Next Shift, five upcoming shifts, and existing monthly-hours calculations.
- [x] Make Records attendance-only with the compact hours summary below the table.
- [x] Verify operator flows, stored history, database cleanup, tests, typecheck, lint, and production build.

## Operator dashboard reference redesign
- [ ] Restyle the inactive Dashboard and floating check-in control.
- [ ] Restyle Calendar while preserving sync and shift actions.
- [ ] Move Records to /records and preserve expandable attendance actions.
- [ ] Verify focused checks, build status, and responsive browser rendering.
