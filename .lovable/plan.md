# Operation 4 — Core domain boundaries (no behaviour change)

This adds a small internal "domain" layer so the app's rules stop living inside the Google Calendar code. Nothing users can see changes: same screens, same sync, same shifts, same notifications. No database migration.

## What gets created

A new `src/domain/` folder holding pure, dependency-free types and rules, plus three thin server-side boundaries. Every piece below replaces logic that exists today — nothing speculative is added.

### 1. Domain types — `src/domain/types.ts`

Plain TypeScript types only (no classes, no runtime code):

- `OperatorId`, `OperatorIdentity` (`{ id, username, isAdmin, isActive }`)
- `CalendarCommitment` — a normalized external calendar observation: `{ source: "google-ics", externalEventId, date, startTime, endTime, allDay, status, title? }`. Explicitly *not* a shift.
- `ClassDefinition` / `ClassInstance` — a class as an app concept, distinct from a calendar event. Mirrors what `calendar_classes` rows already carry; no new storage.
- `DomainShift` — `{ id, date, startTime, endTime, status, label, assignment, identity }`, mapped from existing `scheduled_shifts` rows.
- `OperatorAssignment` — `{ operatorName: string | null }` today, with the mapping helpers `assignmentFrom(row)` / `assignmentToColumn(a)` so the raw `assigned_operator` string stops spreading. Column stays exactly as it is.
- `DisplayClass` — the narrow contract Studio Display already consumes.

### 2. Shift identity — `src/domain/shift-identity.ts`

Today the `op:<operator>:shift:<date>:<HHMM>` format is minted in `gcal.server.ts` and the `manual:...` format in `shifts.functions.ts`, and both are string-matched in several places. This module becomes the single home for:

- `googleShiftIdentity(operatorKey, date, startMin)` — the exact current `shiftUid`
- `googleShiftPrefix(operatorKey)` — the exact current `like` prefix
- `manualShiftIdentity(date, startTime, operator)` — the exact current `manualEventId`, random suffix included
- `isGoogleIdentity(id)` / `isManualIdentity(id)` — replacing scattered `startsWith("op:")` / `startsWith("manual:")` checks

Same strings out. Call sites in `gcal.server.ts` and `shifts.functions.ts` import from here instead of defining their own.

### 3. Shift planning — `src/domain/shift-planning.ts`

`groupClassesIntoShifts` and `SHIFT_CONFIG` (30 min before / 15 min after / gap rule) stay implemented exactly where they are in `gcal-core.ts`. This module re-exports them under domain names so the rule reads as domain logic rather than Google logic. No second algorithm, no edit to the function body, no changed output.

### 4. Operator resolution — `src/domain/operator-resolver.server.ts`

Twelve-plus places currently run their own `from("operators").ilike("username", ...)` lookup or ad-hoc lowercase comparison. This introduces:

- `resolveByUsername(username)`, `resolveById(id)`, `normalizeUsername(name)`, `sameOperator(a, b)`

Migrated in this operation: the duplicated lookups in `shifts.functions.ts`, `travel.functions.ts`, `push.functions.ts`, and the name→id map building in `notifications.server.ts`. Everything else keeps its current call and is listed as deferred, so query counts stay identical (no extra round-trips).

### 5. Shift repository — `src/domain/shift-repository.server.ts`

A small set of functions over `scheduled_shifts` covering only the access patterns that are duplicated today: `findById`, `listInRange`, `listByOperator`, `insert`, `patch`, `remove`. `shifts.functions.ts` and `gcal.server.ts`'s `writeShifts` call these instead of building the same queries inline. No generic repository framework, no ORM, no change to the queries themselves.

### 6. Calendar provider adapter — `src/domain/calendar-provider.server.ts`

```text
Google ICS  ->  GoogleIcsCalendarProvider  ->  CalendarCommitment[]  ->  existing sync logic
```

An interface `CalendarProvider { fetchCommitments(icsUrl, window) }` with exactly one implementation, wrapping the fetch + `parseIcs` step that `runCalendarImport` performs today. The rest of the sync (mode detection, matching, eligibility, shift writing, cleanup, notification reconciliation) is untouched and keeps operating on the same data. This is where the "external systems provide data, the domain decides meaning" line is drawn.

## Service boundary for shifts

`shifts.functions.ts` is already the authorization + mutation boundary for shifts, so it is kept as the service rather than wrapped in a second layer. It gets internal structure only: authorization helpers stay at the top of each handler, and the body delegates to the repository and domain mappers. Assignment changes route through `assignmentToColumn`, keeping assignment conceptually separate from shift creation while the column format is unchanged.

Notifications, Time-to-Leave, Attendance and Studio Display are *not* restructured. They consume the shared domain types and (for notifications) the operator resolver, which documents the intended direction without moving their logic.

## Explicitly not in this operation

No timetable types, no `TimetableProvider`, no DMC API, no schema migration, no operator_id columns, no assignments table, no identity scheme change, no authorization redesign, no transactional sync rework, no UI change.

## Verification

TypeScript, ESLint, the full test suite and a production build. Plus targeted searches confirming: one shift-identity source, no duplicate shift-mutation path, `autoSync` / `syncNextMonth` still absent, and manual current-month-only sync still enforced server-side.
