# Studio Display — preset-based system

Turn the Studio Display page into a simple preset launcher. The teacher-facing `/display` screen, its timer, colours, class info and sequencing stay exactly as they are.

## 1. Page rename

Page title and headings become **Studio Display** (currently "Custom Studio Display"). "Customize" becomes one option inside the page.

## 2. Studio Display homepage

Replace the current always-open configuration panel with a launcher:

```text
Studio Display

[ Workout ]   [ Ballet ]   [ Customize ]

My Presets
[ My Warm-up ]  [ Evening Ballet ]
```

Each card opens the same compact configuration popup.

- Workout — start time + notes; duration fixed at 45 min.
- Ballet — start time + notes; duration fixed at 60 min.
- Customize — start time + duration + notes, plus "Save as preset" (name -> Save).
- Saved preset — same popup pre-filled with the preset's values, adjustable for this session only.

Every popup ends with **Open Studio Display**, which writes the shared display state and opens the existing `/display` window exactly as today.

## 3. Custom presets are per operator

Presets are stored on the operator's own saved preferences record (the same per-operator store already used for sync and notification settings), so Operator A never sees Operator B's presets. Each preset holds: name, duration, optional default notes. Saving, renaming and deleting happen from the Studio Display page; no new pages.

## 4. Smart midnight resolution

The one shared time resolver decides which calendar day an entered clock time belongs to, by picking the **nearest sensible occurrence** (yesterday / today / tomorrow):

- if one occurrence's real interval (start through end, plus the existing Q&A window) contains the current moment, use it;
- otherwise use whichever occurrence is closest in time to now.

Results: 23:00 + start 00:00 -> tomorrow; 23:30 + 00:00 -> tomorrow; 00:10 + 00:00 -> today; 17:00 + 18:00 -> today. A 23:30 class of 60 min resolves to 23:30 today -> 00:30 tomorrow as full datetimes — never a clock-only comparison. Applies to Workout, Ballet, Customize, saved presets and class-launched displays.

The internal `timerMode` field stays for backwards compatibility, but the operator no longer sees or needs the Upcoming/Current toggle; it is removed from the UI.

## 5. Live notes window

Notes can only be edited while the class is actually running (inside the resolved start->end interval, overnight included). Before the class and after it ends, the notes field is disabled/read-only with a short hint. This uses the existing stage computation, no new timer.

## 6. Class-specific flow from Shift Overview

Shift Overview gets a **Go to Studio Display** action per class. It opens the Studio Display page with a temporary class card pinned at the top:

```text
┌──────────────────────────────────────┐
│ Class 1 — Teacher 1                  │
│ 8:00 PM – 9:00 PM                    │
│ [ Workout ] [ Ballet ] [ Customize ] │
│ Temporary class                      │
└──────────────────────────────────────┘
```

- Class id, name, teacher, start, end and duration come from the class record; nothing is re-entered.
- 45-minute class highlights Workout as the default, 60-minute highlights Ballet; Customize stays available.
- The card is styled as clearly temporary (dashed border, muted "Temporary class" tag) and disappears automatically once the class's real end datetime has passed, overnight included.
- It is never saved as a permanent preset unless the operator explicitly uses "Save as preset".

## 7. One configuration model

Workout, Ballet, Customize, saved presets and the temporary class all produce the same configuration object (start time, duration, notes, optional class name/teacher) and feed the existing display state and `/display` engine. No second timer engine, no per-preset display code.

## Technical notes

- `src/lib/studio-display.ts`: rework `resolveClassStart()` to the nearest-occurrence rule described above (keeping `resolveStartAt`, `computeStage`, `buildClassDisplayUrl`, `QA_MS` and the state shape); add a small `studioConfig` type + `notesEditable(state, now)` helper. Add unit tests for the midnight cases and the overnight interval.
- New `src/lib/studio-presets.ts` for preset types/defaults (Workout 45, Ballet 60) and temporary-class encoding/expiry.
- Extend the per-operator prefs server functions with a `studioPresets` array (list/save/delete), keeping existing keys and defaults intact.
- New `src/components/studio/PresetDialog.tsx` (shared popup) and `TemporaryClassCard.tsx`; `StudioDisplayPanel.tsx` becomes the launcher grid and keeps the existing live preview inside the popup.
- `src/routes/studio-display.tsx`: read optional class params (id, name, teacher, start, end) for the temporary card; keep the existing gate redirects and the desktop-only mobile notice.
- `src/lib/page-titles.ts`: `studioDisplayConfig` -> "Studio Display".
- `src/components/ShiftOverviewDialog.tsx`: add the per-class "Go to Studio Display" link (navigates to the Studio Display page with the class params).
- `src/routes/display.tsx` and the display rendering stay untouched apart from the shared resolver improvement.
