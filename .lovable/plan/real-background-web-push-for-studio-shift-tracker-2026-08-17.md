# Real background Web Push for Studio Shift Tracker

Replace the dashboard-only reminder loop (`useReminders`, `new Notification`, 20s interval) with a server-driven Web Push system. Existing profile toggles (`notifyTimeToLeave`, `notifyShiftStart`) stay exactly as they are and keep controlling what gets sent.

## How it will work

```text
Profile toggle (user gesture)
  -> permission prompt -> service worker -> PushSubscription
  -> registerPushSubscription (server, identity from the site-gate session)
  -> push_subscriptions row (one per device)

Every minute: database scheduler -> dispatcher endpoint
  -> finds due "time to leave" / "shift start" events
  -> checks the operator's current preference
  -> claims the delivery (unique key, so never twice)
  -> sends Web Push to every active device, drops dead ones
```

## Database (one migration)

- `push_subscriptions` — `operator_id` (FK to operators, not unique), `endpoint` (unique), `p256dh`, `auth`, `user_agent`, `platform`, `created_at`, `last_seen_at`, `disabled_at`.
- `operator_travel_plans` — minimal server copy of a successful Time-to-Leave calculation: `operator_id`, `shift_start_at`, `shift_end_at`, `departure_at`, `arrival_at`, `travel_minutes`, `transfers`, `route_label`, `calculated_at`, `algorithm_version`, unique on (`operator_id`, `shift_start_at`, `algorithm_version`). The detailed route/map snapshot stays in the browser.
- `push_notification_deliveries` — `operator_id`, `notification_key`, `notification_type`, `scheduled_at`, `sent_at`, `status`, unique on (`operator_id`, `notification_key`). The unique index is the idempotency lock: the dispatcher inserts first and skips if the insert conflicts, so overlapping runs can't double-send.
- All three: RLS enabled, no `anon`/`authenticated` grants. Only server-side code reaches them (same pattern as the rest of this app).
- Shift-start times need no new storage — they're derived from `scheduled_shifts` (`specific_date` + `start_time`) converted from Berlin wall-clock to an absolute timestamp in SQL.

## Server code

- `src/lib/push.functions.ts` — `registerPushSubscription`, `unregisterPushSubscription`, `getMyPushStatus`. Operator identity comes from the existing site-gate session; the browser never sends an operator id. Upsert on `endpoint`, refresh `last_seen_at`.
- `src/lib/push-send.server.ts` — VAPID signing + payload encryption using a Workers-compatible Web Push library (`@block65/webcrypto-web-push`); `web-push` is Node-only and won't run on the edge runtime. Returns per-endpoint results so 404/410 responses disable just that device.
- `src/routes/api/public/hooks/push-dispatch.ts` — the single dispatcher. Verifies a caller key, runs the due-notification query, claims, sends, records. Lateness window of 12 minutes so a delayed run still fires once but an hours-old event is skipped.
- `src/lib/travel.functions.ts` — after a *successful* route calculation, persist the minimal plan row (upsert on shift start + version). A failed calculation leaves the previous good row untouched.

## Client code

- `public/push-sw.js` — a small dedicated worker: `push` (always calls `showNotification`), `notificationclick` (focus an existing window, else open, and only same-origin paths from the payload). No caching, no fetch handler, so app routing, auth, Supabase and Studio Display are untouched.
- `src/lib/push-client.ts` — capability detection (`serviceWorker` / `PushManager` / `Notification`), permission request on gesture only, subscribe/unsubscribe, and a quiet re-registration heartbeat when permission is already granted.
- `src/routes/profile.tsx` — same two toggles; turning one on triggers the permission + subscribe flow and shows one of: enabled / blocked in device settings / not supported on this device. Denial never blocks saving and never re-prompts.
- `src/hooks/useReminders.ts` — the interval and `new Notification` delivery are removed; the dashboard keeps its live countdown only. Server push is the single notification authority.

## VAPID credentials

`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` stored as backend secrets. The private key is read only inside server handlers; the public key is served to the browser through a tiny server function (never hardcoded, never committed).

## Scheduling

One recurring job, every minute, calling the dispatcher endpoint — a single dispatcher for all operators, not one job per operator.

## Rollout

1. Migration + subscription registration
2. Service worker + receiving pushes
3. Dispatcher + delivery records
4. Time-to-leave plan persistence
5. Remove the old local reminder delivery
6. Test + cleanup

## Testing

Typecheck and build after each phase, plus a live check that the dashboard, profile save, calendar sync and Studio Display are unaffected. Push delivery itself I can verify server-side (dispatcher claims, send results, dead-endpoint cleanup) and in a desktop browser via a headless run. Real closed-app delivery on an iPhone Home Screen web app and macOS Safari has to be confirmed by you on the published site — those platforms can't be driven from here, so I'll report that step as pending your confirmation rather than claiming it passed.

## Notes

- Everything scheduled with absolute timestamps; Berlin is used only for display and for converting stored wall-clock shift times.
- One preference system, one notification authority, no browser polling anywhere in the delivery path.
