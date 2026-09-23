# Operator dashboard reference redesign

## Goal
Match the uploaded dashboard reference while preserving all current data, authentication, shift, check-in, calendar-sync, attendance, and editing behavior.

## Changes
- Restyle the inactive Dashboard as a centered 520px column: next shift with integrated leave time, compact upcoming list, linked current-month hours, and a floating 3-second check-in control.
- Upgrade the shared hold control with the requested countdown, cancellation, accessibility, and completed caption without changing its mutation target.
- Restyle the existing Calendar route into the compact Monday-first month view with selected-day details, while retaining shift overview/editing and calendar sync.
- Move the existing Records page to `/records`, keep `/record` as a compatibility redirect, and present its existing worked-shift data as a compact expandable monthly list.
- Update operator navigation links to the canonical `/records` URL and retain route-specific metadata.

## Verification
- Focused tests and TypeScript checks.
- Automatic build status and browser checks at desktop and mobile widths.
