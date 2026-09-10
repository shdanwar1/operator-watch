# calendar_classes audit — verdict: NOT SAFE TO DELETE

The table is live, load-bearing infrastructure. It holds 244 rows covering 2026-08-03 to 2026-09-30 and is read and written on the main daily paths. No deletion should happen; no code changes are proposed.

## What it is for

One row per individual class inside a shift: which operator, which day, start and end time, status (confirmed / completed / cancelled), the shift it belongs to, the original calendar event id, and — since Operation 8 — the canonical DMC class and instructor references. It is the only per-class record in the system. `shifts.classes` is a snapshot written at checkout, not a schedule.

## Application reads

- Dashboard (`src/routes/index.tsx`) — loads the operator's classes, shows the class schedule of the active shift, and drives per-class status.
- Class schedule card (`src/components/ClassScheduleCard.tsx`) and `src/lib/display-shifts.ts` — class timing, ordering and status labels.
- Operator Calendar (`src/routes/calendar.tsx`) and Shift details dialog (`src/components/ShiftOverviewDialog.tsx`) — the class list of a shift.
- Studio Display (`src/lib/studio-display.ts`, `src/lib/studio-presets.ts`) — a display session is keyed by a class row id so a live class can refresh the display.

## Application writes, updates and deletes

- `src/lib/gcal.server.ts` — Google sync inserts, updates and prunes stale class rows; also `setClassStatus`, `addClassToShift`, `updateShiftClass`, `removeShiftClass`.
- `src/lib/shifts.functions.ts` (line 660) — deleting a scheduled shift deletes its class rows.

## Server functions depending on it

`listMyCalendarClasses`, `listMyShiftClasses`, `addMyShiftClass`, `updateMyShiftClass`, `removeMyShiftClass`, `setMyClassStatus`, `syncGoogleCalendar`, `deleteMyScheduledShift`.

## Database objects depending on it

- Foreign keys out: `scheduled_shift_id -> scheduled_shifts`, `dmc_class_id -> dmc_classes`, `dmc_instructor_id -> dmc_instructors`.
- Constraints: primary key, unique `(operator, uid)`.
- Indexes: `calendar_classes_operator_date_idx`, `calendar_classes_dmc_class_id_idx`, `calendar_classes_dmc_instructor_id_idx`, plus the two constraint indexes.
- Trigger: `update_calendar_classes_updated_at`.
- Function: `rename_operator` rewrites `calendar_classes.operator` so history follows a rename.
- No views, no policies (service-role access only).

## Per-area answers

- Google Calendar sync: yes, required. Sync's entire output is class rows; without the table sync produces nothing and shift grouping has no input.
- Live Timetable resolution: no, not required. The resolver reads only the DMC timetable tables. But resolution's *result* is stored here.
- Shift generation/grouping: yes, indirectly. `groupClassesIntoShifts` groups the classes that sync just wrote, and shift start/end derive from them.
- Records: partly. Completed Records read the `shifts.classes` snapshot, but that snapshot is populated from the live class rows during the shift.
- UI: yes — dashboard, calendar, shift details, class schedule card, Studio Display.

## Legitimate or transitional

Legitimate and permanent. It is not Google-matching leftovers: the legacy identity columns (`class_id`, `teacher_id`) and the alias/directory tables were already removed in Operation 8, and what remains is the app's per-class schedule with canonical DMC references. Only `raw_title` is a historical field (original calendar text kept for reference).

## Confirmed retained schema

```text
id                 uuid    not null  default gen_random_uuid()   PK
operator           text    not null                              unique with uid
uid                text    not null
class_name         text    not null                              display snapshot
teacher_name       text    not null                              display snapshot
specific_date      date    not null
start_time         time    not null
end_time           time    not null
status             text    not null  default 'confirmed'
scheduled_shift_id uuid    null      -> scheduled_shifts.id
raw_title          text    null      original calendar text
dmc_class_id       uuid    null      -> dmc_classes.id       (indexed)
dmc_instructor_id  uuid    null      -> dmc_instructors.id   (indexed)
created_at         timestamptz not null default now()
updated_at         timestamptz not null default now()  (trigger-maintained)
```

## Outcome

No changes to make. Operation 8 can be considered complete with `calendar_classes` retained as a permanent table.
