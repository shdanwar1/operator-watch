# Timetable UI Compaction

## Changes
- Reduce the shared 24-hour timetable scale and matching hourly grid spacing without changing time calculations.
- Tighten card padding, typography, and spacing while retaining time, class, instructor, operator, and suspended status.
- Keep class names on one line with automatic ellipsis truncation and prevent card content overflow.
- Preserve operator colors, current-day styling, current-time indicator, seven-day columns, and horizontal scrolling.
- Show Refresh only on the Admin timetable; keep it hidden on the Operator timetable.

## Scope
Presentation only: the shared timetable view, timetable grid presentation, and timetable CSS. No data, date, assignment, navigation, route, authorization, or business-logic changes.

## Validation
Run timetable tests and the full test suite, inspect the automatic type/build result, and visually verify compact desktop and narrow layouts where the existing gate permits access.
