# Studio Display — one live control surface

Keep the current page design, drop Customize and presets, and make the homepage the permanent control panel for the single active display session.

## 1. Homepage

```text
Studio Display

[ Workout ]   [ Ballet ]
```

- Two cards only: Workout (45 min), Ballet (60 min).
- No Customize card, no "Save as preset", no "My Presets" list, no preset management.

## 2. Configuration popup (unchanged shape)

Clicking Workout or Ballet opens the same compact popup with Start time, Notes and **Open Studio Display**. Duration stays fixed per preset. The "Save as preset" block and the editable-duration field are removed.

Pressing Open Studio Display writes the whole configuration (preset name, start time, duration, notes, class/teacher/class id when present) into the shared Studio Display state, opens `/display`, and closes the popup.

## 3. Active display control card

Whenever the shared state holds an active session, the homepage shows it above the two preset cards:

```text
ACTIVE DISPLAY

Workout
18:00 · 45 min

Notes
[ Welcome everyone…                    ]

[ Open Display ↗ ]        [ End session ]
```

- Reads every value straight from the shared state — no second copy in the page.
- Typing in Notes calls the shared `update()` on each change (lightly debounced), so an open `/display` picks it up immediately through the existing BroadcastChannel/localStorage sync.
- Notes stay locked by the existing `notesEditable()` rule: disabled before the class, editable during, read-only after, with the same short hint.
- Open Display reuses the same named window so a second click focuses the existing display instead of spawning another one.
- End session clears the active flag and returns the page to the two preset cards; it does not touch `/display` rendering code.

## 4. Survives navigation

The active session lives only in the persisted shared Studio Display state, so leaving to Dashboard/Calendar/Record/Chat and coming back re-renders the same active card with mode, start time, duration, notes and class/teacher intact. One session, one timer, one `/display`.

## 5. Class-specific launches

The temporary class card from Shift Overview keeps working, minus its Customize button: Workout and Ballet only, pre-filled with the class name, teacher, start time and class id. Launching it produces the same active control card, labelled with the class and teacher.

## 6. Teacher-facing display

`/display` and its countdown, progress, class/teacher and Up Next rendering are untouched.

## Technical notes

- `src/lib/studio-display.ts`: add `presetLabel` and `active` (boolean) to `StudioDisplayState` + defaults; keep `resolveClassStart`, `notesEditable`, `buildClassDisplayUrl`, `QA_MS` as they are.
- `src/components/studio/StudioConfigDialog.tsx`: remove the save-preset block, the `allowSavePreset`/`editableDuration` props and the duration input; keep local start-time/notes state only until submit, then hand the full config up.
- New `src/components/studio/ActiveDisplayCard.tsx`: renders from `useStudioDisplay("control")`, writes notes via `update({ notes })`, holds the window ref for focus-or-open.
- `src/components/StudioDisplayPanel.tsx`: delete preset loading/saving (`getMyPrefs`/`setMyPrefs` usage, `persistPresets`, `savePreset`, My Presets grid, Customize cards) and render `ActiveDisplayCard` when `state.active`. Keep the shared display-window ref here so the same window is reused.
- `src/lib/studio-presets.ts`: keep `StudioConfig`, temporary-class helpers, `WORKOUT_MIN`/`BALLET_MIN`; drop `StudioPreset`, `coercePresets`, `BUILTIN_PRESETS`.
- `src/lib/prefs.functions.ts`: remove the `studioPresets` key from the prefs type/coercion (stored values are simply ignored).
