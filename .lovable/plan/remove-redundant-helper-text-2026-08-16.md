# Remove redundant helper text

Delete the 11 captions that only restate the label sitting next to them. Visual layout stays intact — no spacing gaps left behind.

## Profile (operator)

Drop all five toggle-row hints (`src/routes/profile.tsx`), so each row is just its label and switch:

- Automatic sync
- Next month
- Time to leave (notification)
- Shift start (notification)
- Time to leave card

The `hint` prop stays supported on the shared `ToggleRow` component but is no longer passed here.

## Admin

- Settings: remove the page subtitle "Account, security and system-wide configuration.", the "Check-out confirmation" caption, and the "Data maintenance" caption.
- Operators: remove "Accounts, access and upcoming coverage."
- Shifts: remove "Worked shifts for every operator."
- Calendar: remove "Scheduling across all operators."

## Unlock

- Remove "Choose your profile to continue." under Select User.

## Kept intentionally

These carry information the label alone does not, so they stay:

- Site password → "Unlocks the application. Separate from the admin PIN."
- Studio address → destination for Time to leave estimates
- Lock studio → "Locking requires the site password to re-enter."
- Everything on Complete Profile (first-run onboarding)

Say the word if you want any of those cut too.

## Technical notes

Page-heading subtitles are plain `<p className="text-muted-foreground">` siblings of the `<h1>`; deleting the element also removes its top margin, so headers tighten up naturally. Meta descriptions in each route's `head()` are unchanged — those are for search results, not the UI.
