# Class Studio Display goes through the control page

Today the "Studio Display" button on a class opens `/display` in a popup directly, so the operator never gets a control surface and can't edit Live Notes afterwards. This routes the class through the Studio Display page instead.

## 1. Class button navigates, never opens the display

The class row's Studio Display button navigates to `/studio-display` with the existing class search params (`cid`, `cn`, `tn`, `cd`, `cs`, `ce`). No new transfer mechanism, no popup from the class card.

## 2. The class becomes the active session on arrival

When the Studio Display page loads with those params and no other session is already active for that class, it immediately writes the class into the shared display state: class name, teacher, start time, duration (derived from start/end, overnight aware), class id, `active: true`. The operator never retypes class info and no configuration popup appears for a class launch.

## 3. Persistent Live Notes on the page

The active card on the Studio Display page shows:

```text
Back to Basics
Marco Palamone
1:15 AM – 2:15 AM · 60 min

Notes for display
[ Focus on breathing today…            ]

[ Open Studio Display ↗ ]   [ End session ]
```

The Notes field reads from and writes to the shared state via `update({ notes })` — no second local copy. An open `/display` receives it through the existing BroadcastChannel/localStorage sync. Notes follow the existing `notesEditable()` rule (disabled before, editable during, read-only after) using the real class date so an overnight class such as 26 Aug 23:30 → 27 Aug 00:30 stays editable across midnight.

## 4. One display, always reusable

Open Studio Display uses the existing `buildClassDisplayUrl()` and the single named display window, so a second press focuses the open display instead of spawning another. One session, one timer, one shared state. The control page stays usable while `/display` is open.

## 5. Workout / Ballet unchanged

The two preset cards keep their existing popup flow for non-class launches. `/display` itself — countdown, teacher, class name, progress, Up Next — is untouched.

## Technical notes

- `src/components/ClassScheduleCard.tsx`: drop `openDisplay`/`buildClassDisplayUrl`; the button becomes a `<Link to="/studio-display" search={temporaryClassSearch(...)}>` built from the class row (`id`, `class_name`, `teacher_name`, `specific_date`, `start_time`, `end_time`).
- `src/lib/studio-display.ts`: add an optional `classDate` ("YYYY-MM-DD") to `StudioDisplayState` + defaults, and let `resolveClassStart` pin to that date when present so overnight intervals are exact instead of clock-guessed.
- `src/components/StudioDisplayPanel.tsx`: replace the temporary-class card's Workout/Ballet buttons with an effect that adopts the temporary class into shared state (guarded on `classId` so re-renders and navigation don't restart the session), then render the active card.
- `src/components/studio/ActiveDisplayCard.tsx`: show teacher and the start–end range for class sessions; notes wiring stays as it is.
- `StudioConfigDialog` keeps its current role for Workout/Ballet only.
