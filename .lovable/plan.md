# Current Week Live Class Operator Board

Turn the Admin Live Timetable into the admin's main operational board: this week's classes, Monday to Sunday, each showing who is operating it. No week navigation, no date picker.

## What the admin sees

- Opening the admin area lands directly on Live Timetable (currently it lands on Calendar).
- Header reads "Live Timetable" with the current period, e.g. "14–20 September 2026", plus the existing Refresh button.
- Seven day columns, Monday to Sunday, each labelled with its date.
- Each class card keeps its current look (time, class name, instructor, category) and gains a clear operator line: a coloured dot plus the operator's name, or "Unassigned".
- Suspended classes stay visible exactly as today, with their "Back on …" note. Assignment never changes that state.
- On a new calendar week, the board shows the new week automatically.

## How the operator is decided

For each class occurrence this week:

1. If the dated class record points at a scheduled shift, the shift's current assigned operator wins — so a reassignment made in Admin Calendar shows up here.
2. If that shift is missing, fall back to the operator stored on the class record.
3. If neither exists, show "Unassigned". Nothing is guessed.

Timetable classes with no dated record this week still appear, marked Unassigned.

A database failure shows an error; it is never rendered as an empty week.

## Verified current state

- `calendar_classes` already holds the dated occurrences with `specific_date`, times, `dmc_class_id`, `dmc_instructor_id`, `operator`, `scheduled_shift_id`. Rows exist for 14–20 September (38 rows, 34 linked to a scheduled shift).
- The Live Timetable page today shows only the recurring DMC week with no dates and no operators.
- `/admin` currently redirects to `/admin/calendar`.
- An operator colour helper (`opColor`) already exists in `src/lib/admin-utils.ts`.

## Technical notes

- `src/domain/timetable-week.ts` (new, pure): Berlin current-week Monday→Sunday date list, and merging DMC slots with dated occurrences by date + `dmc_class_id` + start time, resolving assignment by the precedence above. No fuzzy or title matching.
- `src/lib/timetable.functions.ts`: extend the admin-only read to also return, in one batched pass — current-week `calendar_classes` rows (all operators, only the listed fields) and the scheduled shifts referenced by their `scheduled_shift_id` (single `in` query). No per-class queries.
- New server-side reader for those two batched queries, alongside the existing timetable repository; no schema change, no new table.
- `src/domain/timetable-view.ts`: extend the card model with date, operator display name, assignment state, and colour key.
- `src/components/admin/TimetableWeek.tsx`: dated day headers and the operator line; presentation only.
- `src/routes/admin.live-timetable.tsx`: header date range; existing React Query + Refresh mutation kept; no polling.
- `src/routes/admin.index.tsx`: redirect to `/admin/live-timetable`; Admin Calendar stays in the navigation and remains the place to create/edit/reassign shifts.
- Tests: Berlin week calculation (including week rollover and DST), seven-day output, shift-assignment precedence, reassignment reflected, missing-shift fallback, Unassigned cases, timetable-only classes, ID-based matching, suspended behaviour preserved, and a merge test asserting no per-class lookups.
- Validation: typecheck, timetable/calendar-class/shift tests, full Vitest suite, production build.

## Out of scope

No shift generation, no assignment editing here, no Google Calendar changes, no attendance/notification/travel/Studio Display changes, no new tables.
