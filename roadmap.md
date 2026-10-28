# Run credit optimization
## Automation Health
- [x] Add bounded, admin-only automatic-process status storage and reporting; migrations 0007–0009 applied.
- [x] Add Admin Settings health view without changing timings or shift rules.
- [x] Outcome/freshness/access and failure-isolation tests pass; full suite 453 tests, automatic build OK.
- [ ] Real signed-in admin readback and automatic-run verification — blocked: configured site password rejected at Unlock; no admin gate session. SQL-tool execution of service-role-only status RPC was denied; concurrency behavior reviewed in SQL but not exercised against the live database.
## November rotation adjustments
- [x] Add stored, admin-managed adjustments and Ruth's inclusive pause cutoff.
- [x] Resolve assignment by shift day and operator before grouping; preserve worked shifts.
- [x] Seed the two November adjustments, regenerate future schedules, and test acceptance boundaries and guards.
- [x] Automatic build OK; 430 tests pass; two shared-engine regenerations return 63 shifts / 234 classes, no further removals; stored Ruth occurrences from Nov 2 = zero; Dec 1 midnight/01:00 classes belong to Shad.
- [ ] Live admin add/remove flow — blocked: configured site password is rejected by the real unlock screen; no admin gate session available.
## Timecode Studio timeline and library
- [x] Add scheduled-time progress, Now playhead, and marker selection.
- [x] Enrich saved sessions and add confirmed deletion of saved and local drafts.
- [x] Focused tests: 14 passed; automatic preview checks OK.
- [ ] Authenticated browser flow — blocked: the configured site password is rejected by the live unlock screen.

## Ballet Studio Display update
- [x] Add end-relative Ballet segment guidance without changing shared state or Workout timers.
- [x] Verify timing tests and the real display at desktop, portrait and 480×220 sizes — 346 tests passed, automatic build OK, reload/Live Notes/Workout verified with no runtime errors.

- [x] Replace static morning reminders with idempotent one-hour-before reminders and update the dispatch eligibility predicate; reconcile hour keys after retiming/cancellation.
- [x] Verify reminder boundaries with focused tests (30 passed), full suite (300 passed), applied database definition, and automatic build OK. Real phone delivery remains unverified.
- [ ] Move maintenance to 20:00/20:15 Berlin — blocked: existing timers must be managed through Cloud Jobs; no supported schedule tools available.
- [ ] Generate shift-window schedules, advisory-lock trigger, and sync-end refresh — blocked: hand-authored HTTP scheduling through SQL/migrations is unsupported for this existing project.
- [ ] Resolve shift-window safety before activation: a fixed 90-minute opening can miss departure alerts for commutes longer than 75 minutes and delays the existing 14-day Time to Leave preparation.

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
- [x] Restyle the inactive Dashboard and floating check-in control.
- [x] Keep the existing Calendar and Records pages unchanged and link to their current routes.
- [x] Typecheck and automatic build verification completed.
- [ ] Authenticated responsive browser rendering is blocked because the configured site password is rejected by the live gate.

## Operator Dashboard full-width layout
- [x] Widen the active-shift panel to the full content column on desktop (capped at 1280px); mobile keeps its narrow measure.
- [x] Show full class names (wrap to two lines instead of one-line cutoff) and keep times, badges and action buttons from compressing.
- [x] Verified the real class rows at 1440px and 390px; full suite 453 tests pass, automatic build OK.
