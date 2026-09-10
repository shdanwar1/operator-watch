# Operation 9 — Make calendar_classes a rolling operational table

Keep the table. Stop it accumulating history. Records stay the archive.

```text
DMC API -> dmc_classes / dmc_instructors -> Live Timetable
        -> calendar_classes (live schedule)
        -> scheduled shifts -> completed Record / shifts.classes (history)
```

## What the data audit already shows (today = 10 Sep 2026)


| Group                                           | Rows |
| ----------------------------------------------- | ---- |
| Total                                           | 244  |
| Today and future (>= 10 Sep)                    | 104  |
| Past (< 10 Sep)                                 | 140  |
| Past attached to an incomplete/active shift     | 0    |
| Past attached to a shift with a finished Record | 5    |
| Past with no shift link at all                  | 135  |


Two findings that shape the rule:

1. Almost all past rows are already detached from any shift — the shift they belonged to is gone, so nothing operational points at them.
2. Two past days (1 Sep and 3 Sep) have a completed Record whose class snapshot is empty. Deleting those days' class rows would drop information that was never copied into the Record. Those rows are not silently deleted.

## Step 1 — Classify, don't date-filter

A past row is deletable only when all of these hold:

- its date is before today (Berlin), and older than a 2-day grace window
- it has no shift link, or its shift is completed and its Record is checked out
- it is not referenced by an active Studio Display session
- where a Record exists for that shift, that Record's class snapshot is non-empty

Everything else is retained and named in the report.

## Step 2 — One-time cleanup, reported first

Produce the counts before deleting: total, today/future, past, past deletable, past retained with the reason per category (grace window, incomplete shift, empty Record snapshot, Studio Display in use). Then delete only the deletable set.

## Step 3 — Automatic pruning during sync

Google sync already prunes disappeared *future* rows for the synced operator. Add a second pass in the same place that removes the operator's obsolete *past* rows using the exact rule above — same run, same operator scope, no separate job. Pruning never touches today, future, active/incomplete shifts, display-referenced rows, or rows whose Record snapshot is missing.

## Step 4 — History stays in Records

No change to `shifts.classes`; it keeps `class`, `teacher`, `dmcClassId`, `dmcInstructorId`. Nothing in the app starts reading `calendar_classes` for past reporting.

## Step 5 — Boundaries

Table stays. No return of `classes`, `teachers`, `class_aliases`, or legacy title matching. No change to Live Timetable resolution, shift grouping, attendance, notifications, or Studio Display behaviour.

## Technical notes

- Prune logic lives beside the existing stale-future cleanup in `src/lib/gcal.server.ts`, scoped by `operator` like the current delete.
- Retention predicate: `specific_date < today - 2 days` AND (`scheduled_shift_id IS NULL` OR shift completed with a checked-out `shifts` row that has a non-empty `classes` array).
- Studio Display sessions reference a class row id; the check confirms where those sessions are stored before the rule treats them as safe, and a referenced id is always retained.
- Unit tests cover the classifier: future kept, today kept, grace-window kept, incomplete shift kept, empty-snapshot kept, old detached row deleted.
- Validation: manual current-month sync, dashboard class list, shift grouping, Record page, Studio Display, typecheck, full test suite, production build.  
  
  
# Operation 9 — Make calendar_classes a rolling operational table
  Keep the table. Stop it accumulating history. Records remain the historical archive.
  Architecture:
  DMC API
    → dmc_classes / dmc_instructors
    → Live Timetable
    → calendar_classes (live/operational schedule)
    → scheduled shifts
    → completed Record / shifts.classes (historical snapshot)
  ## Current audit
  Today = 10 Sep 2026, Europe/Berlin.
  Current calendar_classes audit:
  - Total: 244
  - Today and future (>= 10 Sep): 104
  - Past (< 10 Sep): 140
  - Past attached to incomplete/active shift: 0
  - Past attached to a shift with a finished Record: 5
  - Past with no shift link: 135
  Two past days (1 Sep and 3 Sep) have completed Records whose class snapshot is empty. Those calendar rows must NOT be deleted merely because the date is old.
  ## Step 1 — Classify past rows safely
  Do NOT use a simple date-only DELETE.
  A past calendar_classes row is deletable only when ALL of these conditions hold:
  1. `specific_date < (today - 2 calendar days)`
     For today = 10 Sep 2026:
     - Sep 10 = keep
     - Sep 9 = keep
     - Sep 8 = keep
     - Sep 7 and earlier = eligible for further classification
  2. The row is not referenced by an active/current Studio Display session.
  3. If `scheduled_shift_id IS NULL`:
     - the row is deletable.
  4. If `scheduled_shift_id IS NOT NULL`:
     - the corresponding scheduled shift must be completed;
     - the corresponding Record must be positively identified;
     - the Record must be checked out/completed;
     - the Record's `classes` snapshot must exist and be non-empty.
  If any of these conditions cannot be positively established, RETAIN the row.
  Never infer that a Record exists simply because a shift is completed.
  ## Step 2 — One-time cleanup
  Before deleting anything, produce a classification report containing:
  - total rows
  - today/future rows
  - grace-window rows
  - past deletable rows
  - past retained because of incomplete/active shift
  - past retained because Record snapshot is missing/empty
  - past retained because Studio Display references the row
  - past retained for any other safety reason
  - total rows to be deleted
  Then delete ONLY the explicitly classified deletable rows.
  The cleanup must be scoped to the relevant operator where the existing sync/delete logic is operator-scoped.
  ## Step 3 — Automatic pruning during Google sync
  Google sync already removes disappeared future calendar_classes rows for the synced operator.
  In the SAME sync operation, add a separate past-retention cleanup.
  The past cleanup must query calendar_classes independently of the current Google sync date range:
  `operator = current operator`
  AND
  `specific_date < today - 2 calendar days`
  Then apply the exact safety classification from Step 1.
  The automatic cleanup MUST NOT delete:
  - today
  - future rows
  - rows inside the 2-day grace window
  - rows attached to active/incomplete shifts
  - rows whose Record snapshot is missing or empty
  - rows referenced by an active Studio Display session
  - rows where the Record/shift relationship cannot be positively verified
  If any safety check fails or returns an uncertain result, retain the row.
  ## Step 4 — History remains in Records
  Do not change `shifts.classes`.
  It remains the historical snapshot containing:
  - `class`
  - `teacher`
  - `dmcClassId`
  - `dmcInstructorId`
  Completed Records are the historical source.
  Do not introduce any new historical reporting that reads old data from calendar_classes.
  calendar_classes is operational schedule data, not the permanent archive.
  ## Step 5 — Preserve the current architecture
  Keep:
  - `calendar_classes`
  - `dmc_classes`
  - `dmc_instructors`
  - Live Timetable
  - scheduled shifts
  - Records
  - `shifts.classes`
  Do NOT restore:
  - `classes`
  - `teachers`
  - `class_aliases`
  - legacy title matching
  - fuzzy class/teacher matching
  Do not change:
  - Live Timetable resolution
  - date-aware Live Timetable active/resumes_on behaviour
  - shift grouping
  - attendance
  - notifications
  - Studio Display behaviour
  - DMC canonical class/instructor links
  ## Step 6 — Studio Display safety
  First inspect and confirm exactly where active Studio Display sessions/reference records are stored.
  A calendar_classes row whose `id` is referenced by an active Studio Display session must be retained.
  If the Studio Display reference check cannot be completed reliably, retain the row rather than deleting it.
  ## Step 7 — Tests
  Add unit tests for the pruning classifier covering at minimum:
  1. future row → KEEP
  2. today row → KEEP
  3. yesterday → KEEP
  4. 2-days-old row → KEEP
  5. older detached row → DELETE
  6. old row attached to incomplete shift → KEEP
  7. old row attached to completed shift with empty Record snapshot → KEEP
  8. old row attached to completed shift with non-empty Record snapshot → DELETE
  9. old row referenced by active Studio Display → KEEP
  10. unknown/unresolvable Record relationship → KEEP
  ## Step 8 — Validation
  After implementation:
  - run manual current-month Google sync
  - verify current/future calendar classes remain correct
  - verify old stale rows are pruned according to the classifier
  - verify shift grouping
  - verify Dashboard class list
  - verify Record page
  - verify Studio Display
  - verify attendance
  - verify notifications
  - verify DMC class/instructor links
  - run TypeScript/typecheck
  - run full test suite
  - run production build
  Report:
  - rows deleted
  - rows retained
  - retention reason for each retained category
  - any rows that could not be safely classified
  Do not silently delete uncertain rows.