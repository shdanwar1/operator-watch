# Operation 5 — Admin Live Timetable

The data half of this operation is already built and verified against the live source: the DMC schedule is fetched on the server, checked field by field, and stored in its own three tables (classes, instructors, weekly slots). A real refresh brought in all 56 weekly slots, 32 classes and 37 teachers with nothing rejected, and running it twice changed nothing.

What is missing is the Admin page itself, plus a few gaps this brief adds. That is what this plan covers.

## What Admin gets

A new page, **Live Timetable**, in the Admin area at `/admin/live-timetable`, added to the Admin navigation between Calendar and Shifts (the same list drives the mobile row, so it appears there too).

The page shows the current DMC weekly schedule:

```text
Live Timetable                         Last updated 9 Sep, 01:20   [ Refresh ]
Current DMC weekly class schedule.

  Monday        Tuesday       Wednesday     ...     Sunday
  ──────────────────────────────────────────────────────────
  08:00–08:45   09:30–10:30                         18:30–19:15
  Ballet Basics Full Body                           Stretch
  Alice Heyward Marco R.                            Nina K.
  [ballet class] [workout]                          [stretching]
                              20:30–21:30
                              Suspended
                              Back on 20 September
```

- Days run Monday through Sunday; times are the studio's own Berlin clock, taken from the schedule key, never converted.
- End time is start plus the source duration, computed as plain wall-clock arithmetic so a midnight class stays on its own day (00:00 + 45 → 00:45; a 23:30 + 60 class shows 00:30 with a small "next day" marker and stays in its source day column).
- Each card shows class name, start–end, teacher (photo when the source has one, initials otherwise), and category/level chips using existing badge styles. Unknown future categories render as-is.
- Suspended slots stay visible, dimmed, with an explicit "Suspended" label and, when present, "Back on 20 September" — the wording, not colour alone, carries the state.
- Refresh is a real button with an accessible label; while running it is disabled and shows progress, so repeat clicks cannot start competing refreshes.
- Loading shows a skeleton grid; failure shows the error while the previously stored timetable stays on screen; a genuinely empty store shows a clear "No timetable stored yet — press Refresh" state.
- On narrow screens the week scrolls horizontally rather than squeezing seven unreadable columns.

Page opens on the stored timetable (fast and resilient). It does not auto-refresh, poll, or sync on focus/visibility — the button is the only live-refresh mechanism.

## Changes to the finished data layer

Small, targeted:

- The read function currently only requires the site gate; it becomes Admin-only to match the page. The refresh mutation is already Admin-only and stays that way.
- A refresh reports slots the source published but that failed validation (currently zero) so Admin can see source anomalies rather than silently losing entries.
- Stale classes and instructors are cleaned up alongside stale slots, so a removed teacher does not linger.
- Refresh commits nothing until the whole snapshot validates, so a failed or malformed response leaves the stored timetable exactly as it was.

`scheduled_shifts` and `calendar_classes` are not read or written anywhere in this work, and no Google Calendar file is touched.

## Technical notes

Existing pieces, unchanged in shape: `src/domain/timetable.ts` (types), `src/domain/timetable-normalize.ts` (pure validation/normalization), `src/domain/dmc-timetable-provider.server.ts` (the only place that knows the DMC API), `src/domain/timetable-repository.server.ts` (upserts keyed on source ids; a moved slot updates in place), `src/lib/timetable.functions.ts` (`refreshLiveTimetable`, `getLiveTimetable`), tests in `src/domain/timetable-normalize.test.ts` (16 passing).

New/edited:

- `src/routes/admin.live-timetable.tsx` — route inside `AdminShell`, `head()` via `pageMeta`, TanStack Query `useQuery` for the stored timetable plus a mutation for Refresh, invalidating on success. Route tree regenerates itself.
- `src/components/admin/TimetableWeek.tsx` + a `TimetableSlotCard` — presentation only, fed a fully resolved view model.
- `src/domain/timetable-view.ts` — pure helpers: `addMinutesLocal(start, minutes)` returning `{ time, nextDay }`, Monday-first day ordering from `dayLocal`, grouping slots by day, and instructor/class lookup maps built once (no per-card work, no N+1 queries).
- `src/lib/page-titles.ts` — add `liveTimetable: "Live Timetable"`.
- `src/components/admin/AdminShell.tsx` — one `ADMIN_NAV` entry (`CalendarRange` icon); nothing renamed or removed.
- `src/lib/timetable.functions.ts` — admin gate on the read; anomalies returned to the page.
- `src/domain/timetable-repository.server.ts` — stale class/instructor cleanup.
- `src/domain/timetable-view.test.ts` — wall-clock end-time arithmetic including midnight and past-midnight cases, and Monday-first ordering. Existing normalization tests already cover schedule-key parsing, weekday mapping, class/instructor resolution, legacy-field rejection, durations, active/resumesOn, and idempotent/moved-slot behaviour.

## Verification

Type check, lint, full test suite, production build; a live refresh from the Admin page; a repeat refresh showing no duplicates; a simulated failure showing the stored timetable intact; and a check that no `scheduled_shifts` row changed.

## Not in this operation

No shift generation, no Google Calendar matching, no operator assignment, no operator-facing timetable, no automatic background sync.
