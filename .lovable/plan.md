# Operation 9 — Make calendar_classes a rolling operational table

Keep the table. Stop it accumulating history. Records stay the archive.

```text
DMC API -> dmc_classes / dmc_instructors -> Live Timetable
        -> calendar_classes (live schedule)
        -> scheduled shifts -> completed Record / shifts.classes (history)
```

## What the data audit already shows (today = 10 Sep 2026)

| Group | Rows |
| --- | --- |
| Total | 244 |
| Today and future (>= 10 Sep) | 104 |
| Past (< 10 Sep) | 140 |
| Past attached to an incomplete/active shift | 0 |
| Past attached to a shift with a finished Record | 5 |
| Past with no shift link at all | 135 |

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
