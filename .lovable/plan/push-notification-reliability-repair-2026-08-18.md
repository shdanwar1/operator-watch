# Push notification reliability repair

## What I traced first

- **Scheduler exists and is healthy.** A recurring database job (`push-dispatch-every-minute`, `* * * * *`) calls the dispatcher on the stable production URL with the anon key. Recent runs all return HTTP 200 (`{"ok":true,"candidates":0,...}`). A second daily job cleans old delivery rows. So item 1 needs no new scheduler — but it lives outside the source tree, so I will record it as a documented, re-creatable configuration and add a health field so a silently broken scheduler is visible.
- **Delivery claim is one-shot.** The dispatcher inserts a row with `status = 'sending'`; on send failure it writes `failed` and the unique `(operator_id, notification_key)` means every later run's insert conflicts and is skipped. A single transient push failure kills that notification permanently. A crashed run leaves `sending` forever.
- **Travel plan write is swallowed.** In `travel.functions.ts` the `operator_travel_plans` upsert is wrapped in `try {} catch {}` with no signal, so background Time to Leave can be missing while the dashboard looks perfect.
- **Subscription drift is detected but not repaired.** `PushDeviceToggle` compares the browser endpoint with the server list and just renders "Off"; nothing re-registers the new endpoint.
- **Lateness window is 5 minutes** — one slow run loses the notification.
- Preferences, service worker, session-based identity and the Test button are already correct and stay as they are.

## Changes

### 1. Delivery lifecycle (one migration)

Add to `push_notification_deliveries`: `attempts`, `last_attempt_at`, `locked_at`, `last_error`, `expires_at`. Keep the unique key.

Add a security-definer function `claim_push_delivery(operator_id, key, type, scheduled_at, expires_at)` that atomically either inserts a new claim or takes over an existing row when it is retryable:

```text
insert ... on conflict (operator_id, notification_key) do update
  set status='sending', locked_at=now(), attempts=attempts+1
  where existing.status = 'failed'                      -- retry
     or (existing.status = 'sending'
         and existing.locked_at < now() - 5 minutes)    -- crashed run
returning id
```

No row returned means another run owns it, or it is already `sent`, or the attempt budget (5) is exhausted — the dispatcher skips. Concurrent runs still cannot double-send because the conditional update is a single atomic statement.

### 2. Dispatcher

- Lateness window 5 min → **15 min**; anything older is marked `expired`, never sent.
- Claim through the new function; after sending, record `sent` / `partial` / `failed` with `attempts`, `last_attempt_at`, `last_error` and per-device counts, so `failed` naturally retries on the next minute tick until the expiry window closes.
- Query travel plans over the widened window and keep the existing preference checks unchanged.

### 3. Accurate multi-device status

`sendToOperator` returns `{ sent, failed, gone, total }`. Dispatcher maps: `total === 0` → `no_subscription` (terminal, not retried), all failed → `failed` (retryable), some failed → `partial` (treated as delivered, not retried), all sent → `sent`. Dead 404/410 endpoints are still disabled and never count as failures that block other devices.

### 4. Travel plan persistence

Persist with an explicit result rather than a swallowed catch:
- retry the upsert briefly on transient failure,
- on final failure return a `plan_saved: false` flag alongside the successful route (dashboard keeps working, local snapshot untouched, no existing good row destroyed),
- the dashboard silently retries the save on its next travel refresh; the failure is visible in the response for diagnostics.

### 5. Silent subscription reconciliation

In `push-client.ts` add `reconcilePushSubscription()`: only when `Notification.permission === 'granted'` and a `PushManager` subscription already exists — never prompts. `PushDeviceToggle` calls it on mount; if the endpoint is not in the server list it re-registers quietly, with no toast.

### 6. Diagnostics

The dispatcher returns a per-job breakdown (`claimed`, `skipped`, `expired`, `sent`, `partial`, `failed`, `no_subscription`) and each delivery row carries status, attempts, last attempt and last error. Nothing sensitive is logged — no VAPID keys, no auth secrets, no subscription keys.

## Untouched

Service worker architecture, notification UI, preference model (`notifyTimeToLeave` / `notifyShiftStart`), session-based operator identity, Test button, Berlin timezone handling, and every unrelated feature.

## Testing

Typecheck plus: a live dispatcher invocation with a seeded due job, a forced-failure run to confirm the retry path reaches `sent`, a 404 endpoint to confirm one dead device does not block the others, an expired job to confirm it is not sent, and preference flags off to confirm suppression. Real closed-app delivery on an iPhone Home Screen app is the final acceptance test and only you can confirm that on the published site — I will report it as pending rather than claim it.
