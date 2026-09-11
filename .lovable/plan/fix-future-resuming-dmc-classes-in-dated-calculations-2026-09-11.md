# Fix future-resuming DMC classes in dated calculations

## Scope

Fix only date-aware timetable eligibility. Keep the recurring timetable source unchanged, preserve the existing Google/manual sync pipeline and shift grouping rules, and do not add timetable-driven shift creation.

## Confirmed root cause

- `resolveDmcTimetableSlot` finds exact Berlin weekday/time/duration candidates, then filters them with `slot.active` only.
- A slot with `active=false` and `resumesOn` equal to or before the Google event date is therefore always reported as suspended.
- Detailed and Free/Busy calendars already share this resolver, so one domain fix covers both.
- Existing shift boundaries are calculated only from resolver-approved Google occurrences and then passed to the unchanged `groupClassesIntoShifts` function. There is no separate future timetable shift generator to modify.
- The weekly Live Timetable view reads raw `active` and `resumesOn` directly and will remain unchanged.

## Implementation

1. Add a pure `isTimetableSlotOperationalOnDate(slot, date)` domain helper.
  - `active=true` is always operational.
  - `active=false` without `resumesOn` is never operational.
  - `active=false` with `resumesOn` is operational when the Berlin-local `YYYY-MM-DD` occurrence date is equal to or later than `resumesOn`.
  - Compare validated calendar-date strings only; do not create timestamps or mutate the slot.
2. Use that helper inside `resolveDmcTimetableSlot` after exact weekday/start/duration candidate lookup.
3. Adjust the sync's empty-timetable guard so a timetable containing only future-resuming slots can still reach dated resolution, while a truly unusable timetable still fails safely.
4. Keep ambiguity handling based on the slots operational for that specific date.
5. Leave the weekly timetable presentation, persistence, `active`, `resumesOn`, Google titles, grouping configuration, assignments, attendance, notifications, and Studio Display untouched.

## Tests and validation

- Add direct eligibility tests for active, permanently suspended, before/on/after resume date, Sunday, midnight, Berlin date boundaries, and immutability.
- Add resolver regressions proving both titled and titleless commitments match on the resume date and fail before it.
- Add the exact 20 September four-class scenario and pass only resolved occurrences into the existing grouping function, verifying `18:00–23:00`; verify pre-resume exclusion.
- Run TypeScript checks, ESLint, the full Vitest suite, and the production build.
- Confirm no database migration and no writes to `dmc_timetable_slots.active` are introduced.
- Make sure it works for both google calendar settings Free/Busy and Full Event details option