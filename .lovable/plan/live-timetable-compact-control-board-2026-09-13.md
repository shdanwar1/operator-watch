# Live Timetable Compact Control Board

## Goal
Restyle only the Admin Live Timetable content to match the supplied dark, dense operational-board reference while preserving all existing data, assignment, suspended-state, refresh, navigation, and responsive behavior.

## Changes
- Keep the page title, replace the subtitle with only “Current Week,” and retain Last updated plus Refresh.
- Tighten the seven-column grid and make each day heading a prominent day name with a smaller muted date and subtle divider.
- Remove instructor images and initials from timetable cards.
- Reduce each normal card to time, class name, instructor name, and operator dot/name.
- Remove category badges and reduce card padding, gaps, radius, and vertical whitespace.
- Keep operator colors through the existing color helper; keep Unassigned neutral gray.
- Preserve suspended cards with compact muted styling, dashed borders, and the existing “Suspended · Back on …” text.

## Scope
Presentation files only: the Live Timetable route and timetable week component. No data fetching, domain logic, database, calendar, assignment, authentication, or other page changes.

## Validation
Run the existing typecheck, tests, and production build, then verify the rendered page at desktop and a smaller viewport where access permits.
