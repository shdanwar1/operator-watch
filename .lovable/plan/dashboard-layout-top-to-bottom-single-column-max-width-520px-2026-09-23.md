Match the uploaded dashboard reference while preserving all functionalities of the APP  
  
Redesign the operator dashboard UI only. Do NOT change any backend logic, Supabase queries, tables, or auth, and do NOT create new pages or routes. The Calendar page and the Records page already exist, so find their existing routes in the project and link to them. Do not modify those two pages. Reuse the existing data hooks/queries for shifts, hours and check-in. First inspect the current dashboard route and components, then modify them in place rather than creating duplicates.

## Dashboard layout (top to bottom, single column, max-width ~520px, centered)

1. "Next shift" section (most important)

   - Small muted uppercase section label "Next shift" (letter-spaced, 12px).

   - A rounded card (radius 22px, 1px border). Left side: weekday in large bold text (30px, e.g. "Friday"), the date muted underneath (e.g. "Sep 25, 2026", do NOT repeat the weekday), then the shift time range at 22px medium (e.g. "7:30 AM → 11:45 AM"), then the class count muted (e.g. "3 classes").

   - Right side of the same card, separated by a thin vertical divider: small uppercase label "Leave at" and the leave time large and bold (28px, e.g. "06:51 AM"). Remove the duplicate "Leave at 06:51 AM" line that currently appears under it.

2. "Upcoming" section

   - Label "Upcoming" on the left of the section header, and a small pill link on the right labeled "Calendar" with a chevron (›) that links to the existing Calendar page.

   - One card with rows and thin dividers between them. Each row: date on the left ("Sat, Sep 26"), time range muted on the right ("1:30 PM → 6:30 PM").

3. "September hours" section (use the current month name)

   - Label on the left, and a small pill link on the right labeled "All records" with a chevron (›) that links to the existing Records page.

   - One card: "Worked" and "Scheduled" totals side by side (small muted label above, 28px semibold value), a thin 6px progress bar (worked / scheduled), a divider, then three columns: Day, Night, Weekend, each with a small colored dot (Day #4f7cff, Night #8b6cf0, Weekend #3fae82), muted label and the hours value below.

4. Clock-in fingerprint button (replaces the big empty card at the bottom)

   - Remove the large card that currently holds the fingerprint button.

   - Make it a fixed, bottom-centered circular button