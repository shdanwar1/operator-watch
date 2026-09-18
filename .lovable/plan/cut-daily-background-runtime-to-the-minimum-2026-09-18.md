# Cut daily background runtime to the minimum

## What I found

I traced every recurring process. There are exactly two scheduled jobs in the backend and no realtime subscriptions, no background Google Calendar sync, no DMC polling, no service-worker timers.

| Process | Trigger | Frequency | Runs app code? |
| --- | --- | --- | --- |
| Notification dispatcher (`/api/public/hooks/push-dispatch`) | database schedule | every minute, 1,440×/day | Yes — this is the main consumer |
| Old delivery-record cleanup | database schedule, 03:17 | once/day | No (pure database) |
| Dashboard auto-refresh | app open | every 30s, 4 requests each | Yes, only while someone looks at it |
| Record page auto-refresh | app open | every 30s | Yes, only while open |
| Calendar sync-status check | app open and visible | every 12s | Yes, only while open |
| Clocks, countdowns, timetable time line, Studio Display timers | app open | local only | No requests |

The daily charge is dominated by the dispatcher: it wakes the application 1,440 times a day, and on the vast majority of those minutes there is simply nothing to send.

Google Calendar is confirmed manual and current-month-only. The DMC timetable is only fetched on an explicit admin refresh. The operator timetable does not poll.

## What I will change

**1. Only wake the app when a notification could actually be due.**
The minute-by-minute schedule stays (shift-start must be exact), but the scheduled command first asks the database a single cheap question: is there any shift starting, or any planned departure, inside the next ~20 minutes? Only then does it call the application. On a normal day that turns ~1,440 wake-ups into a few dozen — one short burst around each shift — while the dispatcher itself, its timing, its claim/idempotency logic and all three notifications stay byte-for-byte unchanged.

The gate is deliberately wider than the real due-window (20 minutes vs 15), so it can never skip a minute the dispatcher would have acted on. If the gate query fails, it falls through and calls the app, so a database hiccup can never silence notifications.

Trade-off to be explicit about: the check still runs every minute inside the database, which is cheap, but it keeps the database awake; that is the price of exact shift-start notifications and is unchanged from today.

**2. Reduce open-app polling.**
- Dashboard and Record: 30s → 90s, keeping the existing refresh-on-focus and refresh-after-sync behaviour, so returning to the tab is still instant.
- Calendar sync-status: 12s → 60s while visible (it already stops when the tab is hidden), and it stops once a sync has landed.

No visible behaviour changes; data still refreshes on focus, after any sync, and on every user action.

## What I will not touch

Notification content, timing, targeting, preferences, the tap-to-check-in flow, attendance rules, timetable logic, operator assignment, Google Calendar behaviour, schema, and all local clocks/countdowns.

## Verification

Typecheck, the full test suite, and a production build. Then I will confirm from the delivery records that notifications still fire on the next real shift; the dispatcher's own logic is untouched, so nothing about the three notifications changes.

## Honest limit

I can measure what the application executes and how often, but I cannot read Lovable's internal metering. If part of the daily figure comes from platform infrastructure rather than these jobs, the remainder will stay after this change, and I will say so rather than claim a reduction I cannot prove.
