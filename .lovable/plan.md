# Operation 8 — Records reference the canonical DMC directory

## What the audit found

There are two places a record stores class/teacher identity today, both as free text:

1. `shifts.classes` — a JSON list of `{ class, teacher }` strings, written by the manual Record flow (add past shift / edit shift) in `AttendanceSection`, chosen from the generic `classes` / `teachers` directories.
2. `calendar_classes` — one row per class, with `class_name` / `teacher_name` text plus legacy `class_id` / `teacher_id` pointing at the generic `classes` / `teachers` tables. Written by Google sync (names already come from the Live Timetable since Operation 6) and by manual class add/edit on a shift.

The canonical directory is `dmc_classes` (32 rows, key `source_class_id`) and `dmc_instructors` (37 rows, key `source_instructor_id`), both refreshed from the DMC API.

Name overlap with history is partial: of 31 distinct stored class names, 18 match a DMC class exactly once after case/punctuation folding; the rest are historic or renamed titles ("Absolute Beginners Barre" vs "Absolute Beginner Barre", "Glutes & Legs" vs "Glutes and Legs", "Back to Basics", "Pre-Production Meeting…"). Those will be reported, not guessed.

## 1. Schema (one migration)

- `calendar_classes`: add `dmc_class_id uuid references public.dmc_classes(id)` and `dmc_instructor_id uuid references public.dmc_instructors(id)`, both nullable, indexed. `class_name`, `teacher_name`, `class_id`, `teacher_id` stay untouched.
- `shifts.classes` entries gain optional `dmcClassId` / `dmcInstructorId` keys inside the existing JSON — no column change.
- Nothing dropped: `class_aliases`, `classes`, `teachers` all remain.

## 2. One-time data migration (exact matching only)

A single SQL pass, run once:

- Class: fold both sides to lowercase alphanumerics; link only when exactly one `dmc_classes` row matches.
- Instructor: fold `first_name || last_name`; link only when exactly one `dmc_instructors` row matches.
- Zero matches or more than one match → leave the reference null and keep the original text.

Applies to `calendar_classes` rows and to each entry inside `shifts.classes`. Afterwards I report counts of: migrated, no DMC class found, no DMC instructor found, ambiguous.

## 3. Going forward

- **Google sync**: the timetable resolver already returns the matched slot, so `gcal.server.ts` writes `dmc_class_id` / `dmc_instructor_id` alongside the existing names. The validation path itself (date + Berlin start + duration → slot) is unchanged.
- **Manual class on a shift** (`addClassToShift` / `updateShiftClass`): accepts DMC class id + DMC instructor id, stores them and stores the DMC names as the display snapshot. Legacy `class_id` / `teacher_id` keep being filled from the generic directory so existing readers stay intact.
- **Manual Record entry** (add past shift / edit shift): the two free-text pickers become DMC class and DMC instructor pickers backed by a new read-only `listDmcDirectory` server function. Selecting stores the id plus the name; rows migrated with no id still display their original text and prompt for a DMC selection on edit.

## 4. Display

Every screen keeps showing the same names it shows today: stored display names remain, so historic records read identically.

## 5. Not in this operation

No fuzzy matching, no `gcal-match.ts`, no `class_aliases` writes, no change to Live Timetable resolution, shift generation, grouping, attendance, notifications, or current-month manual sync. No legacy column or table removal.

## 6. Verification

TypeScript, full test suite, production build, plus new tests for the exact-match rule (case/punctuation folding, ambiguity rejection, no-match rejection) and a guard that no alias writing returns. Then a report of every record that could not be safely linked.
