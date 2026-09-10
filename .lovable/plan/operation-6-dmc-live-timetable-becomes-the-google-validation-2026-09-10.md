# Operation 6 — DMC Live Timetable becomes the Google validation authority

Google Calendar stops deciding what counts as a Dance Masterclass class. From now on, an event only counts if its Berlin date, start time and length exactly match an active slot in the stored Live Timetable. Titles, teacher names and aliases no longer matter — so a calendar shared as "free/busy only" (no titles at all) works fully.

Nothing else changes: shifts are still built by the existing grouping logic, sync stays manual and current-month-only, no tables are added or removed, no screen is redesigned.

## Current behaviour (verified in code)

- `syncBusy` (`src/lib/gcal.server.ts`) keeps a busy block only if `isValidDanceMasterclassClass` says it is 45 or 60 minutes.
- `syncDetailed` loads `classes`, `teachers`, `class_aliases`, runs `matchEvent(title, ...)`, then requires that title evidence plus 45/60 minutes.
- `backfillClassMatches` (`src/lib/gcal.functions.ts`, triggered from Admin Settings) re-runs the same title matcher over stored `calendar_classes` rows.

## New behaviour

Both modes run the same gate:

```text
Google event -> Berlin date + start + end
            -> DMC timetable resolver
            -> active slot with same weekday, start time, duration?
               yes -> accepted, class/instructor taken from the timetable
               no  -> rejected with a reason
```

## What gets built

### 1. Canonical resolver — `src/domain/timetable-resolver.ts` (pure, tested)

- `buildTimetableIndex(slots)` — keys active slots by `dayLocal|startTimeLocal|durationMinutes`, tracking duplicates.
- `resolveDmcTimetableSlot(index, { date, startTime, endTime })` returns one of: `matched` (slot + class + instructor), `no-match`, `suspended`, `ambiguous`.
- Weekday comes from the Berlin calendar date only (plain date arithmetic on `YYYY-MM-DD`, no UTC conversion, so midnight and DST are safe). Start time compared as exact `HH:MM`. Duration computed with midnight wrap, compared exactly — no tolerance.
- A slot with `active = false` yields `suspended`, never a match; `resumesOn` is ignored.
- Two or more active slots on the same weekday/time/duration yield `ambiguous` and are rejected.
- Cancelled and all-day events are rejected before lookup (existing rule kept).
- Only `dayLocal`, `scheduleKey`-derived `startTimeLocal`, `durationMinutes` and `active` are read. `sourceSlotId` stays a reference only.

### 2. Server-side timetable loading — `src/domain/timetable-repository.server.ts`

Add `loadActiveTimetableForMatching()` returning slots plus class and instructor maps in one round trip set (three queries total per sync, not per event). No DMC API call from the sync path.

### 3. Google sync rewiring — `src/lib/gcal.server.ts`

- Load the timetable index once per sync, in both modes.
- If the timetable cannot be loaded or contains no active slots, the sync fails with an explicit error and writes nothing — stored shifts and classes stay exactly as they are. Validation is never widened on failure.
- `syncBusy`: each block goes through the resolver instead of `isValidDanceMasterclassClass`.
- `syncDetailed`: drop the `classes` / `teachers` / `class_aliases` load and the `matchEvent` call from the validation path. Accepted events take `class_name` from `dmc_classes` and `teacher_name` from `dmc_instructors` (first + last name); `class_id` / `teacher_id` are written as `null` because those columns reference the legacy directory tables and the timetable uses different identifiers. `raw_title` still stores the Google title for reference.
- Grouping, shift writing, duplicate handling, label refresh, stale cleanup and the sync window are untouched.
- Diagnostics report timetable reasons: `Matched DMC timetable: Wed 21:30 / 60 min`, `No active DMC timetable slot for …`, `Matching DMC timetable slot is suspended`, `Multiple active DMC timetable slots match …`.

### 4. Legacy title matching

- `backfillClassMatches` is removed together with its Admin Settings button — it exists only to re-apply title matching to DMC rows, which is now the wrong authority.
- `gcal-match.ts` and `class-eligibility.ts` files stay. `aliasKeyFor` is still used by `correctClassMapping` (the operator "fix this class" flow), which is left working as a manual override. Any part that becomes unused is documented, not deleted.
- `classes`, `teachers`, `class_aliases`, `calendar_classes` tables are untouched; no migration.

### 5. Tests — `src/domain/timetable-resolver.test.ts`

Exact active match; suspended slot rejected; no match; empty title accepted; unrelated title accepted; correct-looking title with wrong time rejected; duration mismatch (45 vs 60) rejected; one-minute start mismatch rejected; weekday mismatch rejected; midnight slot `tue0000` resolving to Tuesday; free/busy block with no title accepted; ambiguous duplicate slots rejected; empty timetable index matching nothing. Existing `gcal-core` grouping tests stay untouched to prove grouping is unchanged.  
  
site password "dancemasterclass" and use Shad username and PIN 2024 for testing

## Verification

TypeScript, ESLint, full Vitest suite, production build, plus a search confirming the active Google DMC path no longer calls `matchEvent` or `isValidDanceMasterclassClass`, that `groupClassesIntoShifts` remains the only grouping implementation, and that sync stays current-month-only.

## Not in this operation

No shift generation from the timetable, no Admin Calendar redesign, no operator assignment, no table removal, no attendance/notification/routing/auth changes.