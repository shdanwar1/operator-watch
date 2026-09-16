# Shared weekly timetable

## Presentation

- Replace stacked lists with one shared Monday–Sunday time grid and a fixed left axis, 00:00–24:00.
- Position cards by existing start time and duration; use a sufficiently tall, scrollable grid to retain readable time, class, instructor and operator details. Handle simultaneous classes without covering each other.
- Retain operator-based colors, neutral Unassigned cards, and subdued dashed suspended cards.
- Outline today and show a Berlin-time indicator updated once per minute, only in the displayed current week.
- Show Timetable, the operational month/year, and Week N of M; retain Refresh and bounded Previous/Today/Next controls.
- Preserve full-width empty outside-month columns and horizontal scrolling on narrow screens.
- Simplify the header. Show only:   
Timetable  
(September/Current Month) 2026   
Week 3 of 5 ( or 4 weeks depending on how many weeks are in that month)  
The month and week number must be dynamic.   
Examples:  
September 2026  
Week 1 of 5   
September 2026  
Week 2 of 5  
September 2026  
Week 3 of 5  
September 2026  
Week 4 of 5  
September 2026  
Week 5 of 5  
Do NOT show the current week date range in the main subtitle.   
Do NOT show: "September / October 2026 · 14–20 Sep" Do NOT show additional explanatory text.   
Keep the existing: - Refresh button - Previous Week button - Today button - Next Week button   
The navigation should remain in the existing general location.

## Routes and access

- Keep `/admin` opening the existing `/admin/timetable` and retain its current navigation order.
- Add `/timetable` for signed-in operators using the same shared view. Keep the operator dashboard as the normal landing page.
- Put Calendar, Shifts, Timetable first in operator navigation; retain Dashboard, Record, Display and Profile access afterward. Use a horizontally scrollable mobile navigation bar rather than squeezing all destinations.
- Permit authenticated operators to read the same current-month board. Keep DMC source refresh admin-only; the operator Refresh reloads the stored board without modifying it.

## Technical scope

- Extract the current page into a shared timetable view with role-specific refresh behavior and query keys.
- Reuse month/week helpers, board resolution, assignment lookup and dated suspension logic unchanged.
- Add only the necessary authenticated read permission; do not change tables, assignments, attendance, notifications or external integrations.
- Define grid styling and semantic color tokens centrally; retain existing operator color mapping.

## Validation

- Add focused grid/timezone, month-boundary, navigation, shared-view and access regression tests; run the full test suite.
- Inspect automatic type/build results and check desktop/mobile rendering and routes where the existing gate permits access.
- Physical-device or authenticated checks unavailable without a signed-in gate session will be explicitly identified rather than claimed as passed.