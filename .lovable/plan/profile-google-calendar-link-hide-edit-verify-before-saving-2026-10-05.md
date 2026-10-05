# Profile: Google Calendar link — hide, Edit, verify before saving

## What the operator sees
- The Google Calendar card shows only the status ("Connected" / "Not connected") with an **Edit** button on the same row, like "Change" for the home address. The link itself is no longer shown on the page.
- Pressing Edit opens a small window with the current calendar link filled in, ready to change.
- **Save** first checks the new link:
  - Working Google Calendar link: it's saved, the window closes and the card shows "Connected".
  - Wrong or unreachable link: a red error appears in the window, the link isn't saved, and the old link keeps working.
- Cancel closes the window without changing anything.

## How the check works
Today, a link is only checked for the right shape before it's saved; nobody actually opens it. The new check runs when you press Save:
1. Same shape check as today (Google Calendar address ending in `.ics`).
2. The app opens the link and confirms it really returns a calendar. The calendar must be public and the address must exist.
3. The link is saved only if both pass. Otherwise you see a clear message such as "This link doesn't open a public Google Calendar. Check that the calendar is public and copy the iCal address again."

## Technical details
- `setMyCalendarUrl` (in `src/lib/gcal.functions.ts`): after `normalizeIcsUrl`, fetch the URL using the existing `safe-fetch.server` helper (with a timeout). Require HTTP 200 and a body that starts with `BEGIN:VCALENDAR`. Throw a friendly error before the database update if either fails. Empty input keeps today's "clear the link" behaviour.
- `src/routes/profile.tsx`: the Google Calendar card becomes one Status row with an Edit button. Add an `EditCalendarDialog` that follows the same pattern as `ChangeHomeDialog`: input, Cancel, then Save showing "Verifying…" while it checks. On success it updates the `icsUrl` state and shows a "Calendar link updated" toast. On failure it shows the error inside the window and keeps it open.
- No database changes. Calendar sync and the admin side are unchanged.
