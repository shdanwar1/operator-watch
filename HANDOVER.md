# Operator Watch — Handover Document

For **DMC (Dance Masterclass)**. This document explains how the system works, how it is secured, and what to do when taking ownership.

---

## 1. System Overview and Architecture

Operator Watch is the studio's shift-tracking and operations app. Studio operators use it to clock in/out of shifts, work through start-of-shift, per-class, and end-of-shift checklists, and see when they need to leave home. Studio managers use it to schedule operators, review shift logs and checklist records, and manage accounts.

### Technology

- **Frontend + backend in one app:** TanStack Start (React 19) with server functions. Both the user interface and the server logic live in the same codebase and deploy together.
- **Database and secrets:** Lovable Cloud (managed Postgres + row-level security + server secrets). All data — operators, scheduled shifts, worked shifts, checklists, notification devices — lives in the database.
- **Hosting:** Published at `https://operator-watch.lovable.app`.
- **Timezone:** All shift dates and times are interpreted in **Europe/Berlin**, regardless of where the server runs.

### Key architectural decisions

| Area | Approach |
|---|---|
| Authentication | Custom two-stage "kiosk gate" (see section 2). **No email/password accounts.** |
| Checklists | Four flat master templates (start shift, ballet class, workout class, end shift). When a shift is opened, a **snapshot** of the templates is stored on that shift — later template edits never change history. Completion state belongs to the snapshot, never the template. |
| Time to Leave | `scheduled_shifts.time_to_leave` is the **single source of truth**. It is calculated once from the operator's home address and the studio address via the VBB/BVG public transport API, stored, and only recalculated when the shift timing, assignment, or a relevant address changes (database triggers handle invalidation). There is no background travel system. |
| Notifications | Web push (VAPID). Registered on **mobile/tablet devices only**. Every assigned, non-cancelled shift always gets exactly three notifications: Time to Leave, 15 minutes before shift, and shift start. A daily dispatch hook (`/api/public/hooks/push-dispatch`) sends what is due. |
| Calendar import | Operators can import classes from a Google Calendar ICS feed or the DMC timetable. Import populates scheduled shifts; it never silently deletes existing assignments. |

### Important source locations

- `src/lib/gate.functions.ts` — site unlock, operator PIN sign-in, session handling
- `src/lib/operators.functions.ts` — operator management (create, rename, PIN reset, activate/deactivate, delete)
- `src/lib/shifts.functions.ts` — check-in, check-out, shift data
- `src/lib/checklists.server.ts` — checklist snapshots and per-item completion
- `src/lib/time-to-leave.server.ts` — Time to Leave calculation
- `src/lib/push.server.ts` / `src/lib/notifications.server.ts` — push scheduling and delivery
- `src/routes/` — pages: `/` (operator dashboard), `/calendar`, `/record`, `/studio-display`, `/profile`, `/admin/*` (admin area), `/unlock` (sign-in)

---

## 2. Authentication and Roles

The app has **no usernames/emails with passwords** in the conventional sense. Access is a two-stage gate, designed for a shared studio device (kiosk):

1. **Stage 1 — Site unlock password.** One shared password for the whole studio. Anyone who knows it reaches the profile picker. The initial default is `dancemasterclass` — **change this on day one** (see below).
2. **Stage 2 — Operator PIN.** Each operator picks their own profile and enters their personal 4-digit PIN.

Sessions are stored in a secure, httpOnly cookie and last 30 days. "Sign out" returns to the profile picker but keeps the site unlocked; "Lock site" clears everything.

### Roles

- **Operator** — dashboard, check-in/out, checklists, calendar, records, studio display, own profile (username, PIN, home address, calendar import).
- **Admin** — everything an operator can do, plus the `/admin` area: timetable, calendar, all shift logs, checklist records, operator management, and settings. An operator is flagged admin in the `operators` table (`is_admin`). There must always be at least one admin.

### How to change credentials

- **Site unlock password:** sign in as an admin → `/admin/settings` → change site password (requires the current password; new password must be at least 6 characters).
- **Your own PIN:** Profile page → change PIN (requires current PIN).
- **Any operator's PIN:** admin → `/admin/operators` → select operator → reset PIN.
- **Deactivate an operator:** admin → Operators → deactivate. Their future shifts can optionally be unassigned in the same step. Deactivation ends their session at the next status check.
- **Delete an operator:** admin → Operators → delete (admins cannot be deleted). Past shift records are kept for payroll.

> Server-side, passwords and PINs are stored only as one-way hashes and verified by security-definer database functions. They are never readable from the database or the app.

---

## 3. Daily Operator Workflows

### Shift check-in

1. Unlock the site, pick your profile, enter your PIN.
2. The dashboard shows **Next shift** (day, date, time range, class count) and **Leave at** (Time to Leave).
3. At shift time, **press and hold the fingerprint button for 3 seconds** to clock in. The ring fills while holding; releasing early cancels.
4. If the operator arrives without a scheduled shift, an ad-hoc shift is created.

### Checklists during the shift

- On check-in, the shift receives a **snapshot** of the master checklist templates.
- The dashboard shows three groups: **Start of shift**, one **independent checklist per eligible class** in the shift (45-minute classes use the Workout template, 60-minute classes use the Ballet template), and **End of shift**.
- Tapping an item marks it complete with a Berlin-time timestamp. Completion survives page reloads and is stored immediately, item by item.
- Items cannot be changed after check-out.

### Check-out

Press and hold to check out. The shift (including its full checklist snapshot) is closed and becomes a permanent record.

### Studio display mode

`/studio-display` is a read-only, always-on screen for the studio (e.g. a wall tablet) showing the current/next class and live control state. It is driven from the Control page and requires the site to be unlocked. It is presentation-only — it changes no data.

---

## 4. Administration and Scheduling

All admin pages live under `/admin` (requires an admin PIN):

| Page | Purpose |
|---|---|
| **Timetable** (`/admin/timetable`, admin home) | Weekly recurring timetable — the studio's class grid. |
| **Calendar** (`/admin/calendar`) | Dated schedule. Create/assign/reschedule/cancel shifts for operators. |
| **Shifts** (`/admin/shifts`) | Full log of worked shifts: operator, check-in/out times, classes, notes. |
| **Checklists** (`/admin/checklists`) | Edit the four master templates (add/rename/reorder/delete items) and view **read-only historical records** of completed checklists per shift, with completion times. Historical records are snapshots — editing a template never alters them. |
| **Operators** (`/admin/operators`) | Create operators (username + 4-digit PIN), rename, reset PINs, activate/deactivate, delete. Shows each operator's future shift count. |
| **Settings** (`/admin/settings`) | Change the site password, studio address (Google Maps link — used for Time to Leave), and other studio-wide settings. |

### Scheduling notes

- Shifts are assigned to operators on the calendar; unassigned shifts show as "unassigned" until someone takes them.
- Operators may import their own Google Calendar ICS feed from their Profile to populate their schedule.
- Cancelling or retiming a shift automatically removes its pending notifications and clears its stored Time to Leave.

---

## 5. Handover Checklist for DMC

Complete these steps when taking over the system:

1. **Rotate the site unlock password.** Sign in as admin → Settings → change site password. The default `dancemasterclass` must not remain in use. Share the new password only with staff who need it.
2. **Rotate all PINs.** Reset the admin PIN and every operator PIN from `/admin/operators`. Treat the initial PINs as temporary.
3. **Add the real operators.** Create one profile per studio operator (username + 4-digit PIN). Deactivate or delete any placeholder/test accounts. Keep at least two admins so a single lost PIN cannot lock out management.
4. **Have each operator complete their profile.** On first login each operator sets their home address (Google Maps link) — required for Time to Leave — and optionally connects their Google Calendar ICS feed.
5. **Set the studio address.** Admin → Settings → studio Google Maps link. This drives Time to Leave for everyone; changing it automatically recalculates upcoming values.
6. **Configure the DMC directory / timetable.** Load the current class timetable (Admin → Timetable) so class checklists and the studio display resolve the right classes.
7. **Verify environment secrets.** In the Lovable Cloud backend, confirm these exist and are current: `SESSION_SECRET` (session encryption), `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` (push notifications), and the database/API keys managed by the platform. Rotating `SESSION_SECRET` signs everyone out once — that is expected.
8. **Verify push notifications on a real phone.** On a mobile device: Profile → Notifications → enable on this device, confirm the device appears in the list, and confirm a test shift produces the three expected notifications. Desktop browsers are intentionally rejected.
9. **Confirm the push dispatch schedule.** The daily dispatch hook (`/api/public/hooks/push-dispatch`) must be called on a schedule (external cron or database scheduler) for notifications to be sent.
10. **Do a full dress rehearsal.** With a test shift: unlock → PIN sign-in → hold-to-clock-in → complete start/class/end checklist items → hold-to-clock-out → confirm the shift appears in Admin → Shifts and the checklist record in Admin → Checklists with correct Berlin times.
11. **Publish.** After any database or code change during handover, publish the app so the live site matches what you tested.

---

## Support notes

- The published URL is `https://operator-watch.lovable.app`. The stable project URL (`project--a5a2a5ad-bdfa-419f-86a1-295667413520.lovable.app`) is safe to use for cron/webhook configuration — it does not change if the project is renamed.
- Historical data (shifts, checklist records) is keyed by operator name and survives renames; deleting an operator keeps their past shifts for payroll.
- If everyone is unexpectedly signed out, the most likely cause is a rotated `SESSION_SECRET` — simply sign in again.
