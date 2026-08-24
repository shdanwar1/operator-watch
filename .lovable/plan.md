# Biggest UI/UX Upgrade: one Shift Card that owns the whole shift lifecycle

## The single biggest problem I found

The operator's job is **one continuous lifecycle** — *leave home → check in → run the classes → check out* — but the app splits that lifecycle across four different visual containers with four different shapes, and then splits the *record* of it across three more pages.

On the Dashboard today, the same shift appears as:

- **Time to Leave card** (hero, aurora background, big clock, transit timeline)
- **Check In card** (narrow `max-w-sm`, centred, hold-to-confirm)
- **Active Shift panel** (replaces both once checked in — different layout, different width, class editor inside)
- **Upcoming shifts sidebar** (340px rail, repeats the same shift a fourth time)

They never coexist coherently: the layout jumps between a wide hero, a narrow centred card, and a full-width panel as the clock moves. Nothing on the screen is stable, so the operator has to re-orient every time they open the app. Meanwhile the same shift's *history* lives on **Shifts** (worked rows), **Attendance** (monthly totals of those same rows) and **Calendar** (scheduled version of the same rows) — three top-level nav items describing one dataset. Seven sidebar items / six mobile tabs for what is really two jobs: *my current shift* and *my schedule & record*.

Consequences: shifting hierarchy, duplicated shift data, weak state feedback (you can't see at a glance whether you're pre-shift, en route, on air, or done), and a mobile tab bar with six 52px targets crammed into a 430px row.

## The upgrade

**Replace the three swapping Dashboard cards with a single stateful Shift Card, and let it be the Dashboard.** One container, fixed position, whose *content* changes across five states rather than the layout changing.

```text
+------------------------------------------------------+
|  ● ON AIR            Wed 24 Aug   11:30 PM - 2:00 AM |   <- status strip: one row,
|                                                       |      state colour + shift range
|  Checked in 11:28 PM              1h 12m elapsed      |
+------------------------------------------------------+
|                                                       |
|   [ primary action — fills the state ]                |   <- ONE action, always here
|      CHECK OUT   (hold)                               |
|                                                       |
+------------------------------------------------------+
|  Classes            3 done · 1 running · 2 upcoming   |   <- collapsible detail
|  > 11:30  Vinyasa        Anna          done           |
|  > 12:30  Deep House     Mark          running        |
+------------------------------------------------------+
```

The five states of the same card:

| State | Trigger | Status strip | Primary action | Detail region |
|---|---|---|---|---|
| No shift soon | more than 6 h to next shift | "Next shift Fri 18:00" | **Start unscheduled shift** (hold) | Next 3 upcoming |
| Leave window | 6 h → 1 h before start | "Leave in 12 min" + departure clock | Directions (expand) | Transit timeline (today's Time-to-Leave content) |
| Check-in window | 1 h before start → shift end | "Starts in 24 min" | **Check In** (hold) | Classes for the shift |
| On air | checked in, not out | "On air · 1h 12m" | **Check Out** (hold) | Live class list + editor |
| Just finished | checked out < 30 min ago | "Checked out 2:04 AM · 2h 34m" | — | Summary, link to record |

Timing rules the state machine uses:

- **Leave window opens 6 hours before shift start.** Time to Leave content (departure clock, transit timeline) is available from that point, so the card shows travel info well before the check-in affordance appears.
- **Check-in window opens 1 hour before shift start** and stays open until the shift's scheduled end. Inside this window the primary action is Check In against that scheduled shift.
- **Check-in is always available.** If no scheduled shift starts within the next 2 hours, the primary action is still a check-in — it just starts an **unscheduled shift with no classes**, exactly as today (`resolveCheckInTarget` already returns `null` in that case and the existing unscheduled path handles it). The operator is never blocked from checking in.

Everything the Dashboard currently renders survives — Time to Leave, transit steps, check-in, class editor, upcoming — it just stops being four competing cards and becomes one card with a fixed anatomy: **status strip → one primary action → collapsible detail**.


Second half of the same change: **navigation collapses 7 → 4.** `Shifts` + `Attendance` merge into one **Record** page (month header with the existing totals, then the existing worked-shift rows below — they are already the same rows). Nav becomes **Dashboard · Calendar · Record · Chat**, with Profile and Studio Display moving to a top-bar menu. Mobile tabs go from six cramped targets to four comfortable ones.

## Why this is the highest-leverage change

It simultaneously fixes: information hierarchy (one thing is the most important thing, always in the same place), speed (the next action is always the same pixel — zero scanning), consistency (one card anatomy replaces four ad-hoc ones), redundancy (a shift is described once, not four times), mobile (a single full-width card is the ideal phone layout, and four tabs beat six), and error prevention (state is stated explicitly, so "am I checked in?" is never a question). No cosmetic change achieves any of that.

## Pages affected

- `src/routes/index.tsx` — restructured (the bulk of the work; existing sub-components are reused, not rewritten)
- `src/components/AppShell.tsx` — nav list 7 → 4, mobile tabs 6 → 4, overflow menu
- `src/routes/earnings.tsx` + `src/routes/shifts.tsx` — merged into one Record route, old paths redirect
- Nothing else changes. Admin, Calendar, Chat, Studio Display, Profile untouched.

## Reused as-is

`TimeToLeaveCard` internals (`BestOptionSection`, `DirectOptionSection`, `StepRow`, transit icons), `HoldButton`, the class editor + `ClassScheduleCard` from `ActiveShiftPanel`, `UpcomingShifts` list, `resolveCheckInTarget` in `display-shifts.ts`, the attendance summary/table components. No server functions, no data model, no queries change.

## What actually gets rewritten

The Dashboard's top-level composition: a `ShiftCard` shell plus a small pure `shiftPhase(now, shifts, active, departure)` selector (unit-testable) that picks one of the five states. The current branchy `active ? … : (timeToLeave + checkIn)` tree goes away.

- Implementation complexity: **Medium**
- Risk to existing functionality: **Low–Medium** — presentation and routing only; check-in/check-out and travel logic are moved, not modified. Old `/shifts` and `/earnings` URLs redirect.

Approve and I'll build it — or tell me to keep the 7-item nav and do the Shift Card alone.
