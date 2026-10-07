# Fix Dashboard after early check-out

## Problem (seen in your screenshots, 21:26)
You checked out of the 19:00–21:30 shift at 21:24. Calendar marks it Completed and Records saved it, but the Dashboard still:
- shows it as "Next shift — Today 19:00 → 21:30"
- shows the yellow "Your shift started 2h 27m ago" warning next to the clock-in button, inviting you to clock in again.

Cause: the Dashboard picks the next shift and the clock-in target from the clock alone ("hasn't ended yet"). The earlier fix only hid the big takeover screen, not these two places.

## Fix
A shift you have already checked out of (or that is marked completed) counts as finished on the Dashboard, even before its scheduled end:
- Next shift card moves straight to the following shift (Thu 08 Oct 16:30 → 21:30), and Upcoming starts after that.
- The clock-in button no longer targets the finished shift, so the "started … ago" warning disappears. Clocking in again would be an unscheduled shift, as normal.
- Leave at follows the new next shift.
- Right after check-out the Dashboard updates immediately (no waiting for a refresh).

## Not changed
Check-in/check-out rules, auto check-out, Calendar, Records, notifications, Time to Leave calculation, admin.

## Technical details
- `src/routes/index.tsx`: build a `done` set of scheduled-shift ids from `history` rows with `check_out_at` plus `scheduled` rows with `status === "completed"`. Filter display shifts whose segments intersect `done` out of `upcomingDisplay` (drives `nextDisplay`, Upcoming, takeover).
- `resolveCheckInTarget(scheduled, now, leadMs, isDone?)` in `src/lib/display-shifts.ts`: optional predicate skipping done shifts; pass it from the Dashboard. Add tests in `display-shifts.test.ts`.
- On successful checkout, append the closed row to local `history` (and mark the scheduled row completed) before refetch.
