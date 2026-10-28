# Recommended next upgrade: Automation Health

## 1. Current stage and health

**Stage: active operational tool, now in hardening and targeted polish.** DMC has real operator workflows, saved shift records, scheduled reminders, automatic checkout, live timetable-derived shifts, and dated rotation exceptions. The next priority is confidence in those workflows—not another major feature.

**Current signals:**
- Lovable Cloud database is up, with 58% memory use, 20% disk use, and 11 of 60 database connections in use. No recent resource-exhaustion alerts were returned; capacity expansion is not indicated today.
- Project monitoring has no pending findings. This is not proof that every workflow is correct.
- The preview opens the Unlock Studio screen with no browser runtime errors in that check.
- The last recorded verification reports 430 passing tests. Tests were not rerun for this read-only review.
- Several signed-in acceptance checks remain open in the project roadmap. This review did not exercise live operator/admin actions or real phone notification delivery.

**Main friction found:**
1. Automatic processes lack a consolidated, durable admin health view. Some errors are only logged; automatic checkout returns zero both when nothing closes and when certain reads fail. That makes diagnosis harder without proving the process itself is currently broken.
2. Timecode changes save locally and then remotely, but remote failures rely on a temporary toast. Operators cannot consistently tell whether their latest markers are saved remotely or only on the current device.
3. Records initial loading has no error catch/retry state. If the first fetch fails without a cache, empty arrays can appear as zero hours/no completed shifts instead of unavailable records.

## 2. Top three improvements

| Priority | Upgrade | Operator / operational impact | Estimated effort | Risk |
|---|---|---|---|---|
| 1 | **Automation Health in Admin** | Makes timetable sync, shift generation, reminders, and automatic checkout failures or stale runs visible before they become unexplained operator problems. | Roughly one focused day | Low–medium: touches automatic paths, but only for status reporting |
| 2 | **Persistent Timecode save status** | Shows Saving, Saved, or Device copy only, reducing uncertainty about live class markers. | A few hours | Low–medium: overlapping saves must not report an older save as current |
| 3 | **Records error recovery** | Prevents failed loading from looking like zero worked hours; preserves cached records and offers Retry. | Around 1–2 hours | Low: localized loading/error presentation |

These are estimates, not fixed delivery guarantees. Capacity tuning or broader visual redesign has less evidence-backed leverage today.

## 3. Why number one wins today

**Recommend a compact Automation Health section in Admin Settings.**

Recent changes made the timetable responsible for operator assignment as well as class schedules. Reminders and automatic checkout also need to work while the app is closed. A visible result for these processes supports the whole studio, rather than one screen, and addresses the recurring difficulty of explaining whether an automatic action ran.

Timecode save visibility is the strongest operator-facing runner-up; Records recovery is the fastest small fix. Neither gives the same cross-workflow diagnostic coverage. This recommendation is about visibility, not a claim that the backend is completely solid or currently failing.

## 4. Concise implementation plan

1. **Capture outcomes from the existing processes.** Record last attempt, last success, duration, and a sanitized outcome for timetable sync, reminder dispatch, and automatic checkout. Separate timetable snapshot success from shift-generation success.
2. **Distinguish failure from legitimate inactivity.** A successful run with nothing due is not an error. Partial failures remain visible even when other work succeeds. Reminder dispatch success must not be labeled proof of delivery to a phone.
3. **Add one compact admin view.** Show the three process rows with status, last successful check, relevant counts, and expandable last-error details. Include loading, unavailable, and never-observed states; no new operator dashboard card.
4. **Validate without changing schedules.** Test success, no-op, partial failure, failed reads, freshness classification, and admin-only access. Verify the signed-in view and existing process results where access is available; explicitly report anything that remains unverified.

## Technical scope and safeguards

- Use the existing shared engines and signed gate-cookie admin boundary; no Supabase user sessions or bearer middleware.
- Store a bounded latest-status record per process rather than an unbounded log of every minute. Throttle unchanged healthy/no-op heartbeats to avoid unnecessary writes; surface freshness using each existing process's actual cadence.
- Keep status writes independent of the business outcome: a telemetry failure must not prevent sync, notification dispatch, or checkout. Await bounded writes within the current invocation rather than relying on detached work.
- Prevent overlapping invocations from replacing newer status with older results.
- Keep stored diagnostic details sanitized and admin-only. No passwords, notification credentials, or device endpoints in the UI.
- Do not change timers, reminder timing, operator assignments, checkout eligibility, records, or rotation rules. Do not add manual replay buttons or new background workers.
- Document the status storage/access boundary and test the relevant outcome rules alongside existing tests.

**Approval requested:** implement Automation Health only. The Timecode and Records improvements remain separate candidates, not additional scope.