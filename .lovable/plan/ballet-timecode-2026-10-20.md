# Ballet Timecode

A dedicated timecode tool for Ballet classes, opened from the class card the same way Studio Display is.

## What operators get
- **Timecode icon** on every Ballet class card on the Dashboard. Workout classes don't get one.
- Tapping it opens the **Timecode page** for that class: a new window on desktop, the same window with a Back button on phones and tablets (the same rule Studio Display uses).
- **Timecode page:**
  - Class name, teacher and date at the top.
  - A large running clock at 25 fps. It starts at `01:00:00:00` when the operator presses **Start timecode**, with Pause/Resume.
  - Quick-mark buttons (Highlight, Combination, Correction, Moment) plus an optional note. Each press records the current timecode.
  - A list of markers, newest first, where each note can be edited or deleted.
  - A start-to-end line showing where each marker falls in the class.
  - An **Export EDL** button that downloads a file in the same format as the one you attached: non-drop-frame, one cue per marker, with its label and note.
- Each class keeps its own markers, so reopening the class shows them again.

## Technical details
- `src/lib/timecode.ts`: pure helpers for frames to `HH:MM:SS:FF` at 25 fps, the elapsed-to-timecode offset from `01:00:00:00`, and the EDL serializer. Tested against the attached file's structure.
- Ballet detection reuses `toDisplayCategory(...) === "Ballet"`, with the existing 60-minute classification as the fallback.
- Storage: a new `class_timecodes` table (class id, start instant, markers as JSON, updated at) with GRANTs and RLS. Reads and writes go through gate-authenticated server functions, the same pattern as checklists. A local draft is kept so marking still works if the connection drops.
- New route `src/routes/timecode.tsx` (`?classId=`) with head metadata. The open logic mirrors `prefersInAppDisplay()`.
- `ClassScheduleCard.tsx`: adds the icon button next to Copy, only for Ballet classes.
- Tests: timecode formatting, the 01:00:00:00 offset, and EDL output.
