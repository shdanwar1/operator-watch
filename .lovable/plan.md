# Operation 8 — Records reference the canonical DMC directory, then legacy cleanup

Target end state:

```text
Live Timetable  ->  DMC directory (dmc_classes / dmc_instructors)  ->  Records
```

No other class/teacher layer survives unless the audit proves it still has a real job.

## What the audit found so far

Two places store class/teacher identity as free text today:

1. `shifts.classes` — a JSON list of `{ class, teacher }` strings, written by the manual Record flow (add past shift / edit shift), chosen from the generic `classes` / `teachers` lists.
2. `calendar_classes` — one row per class, with `class_name` / `teacher_name` text plus `class_id` / `teacher_id` pointing at `classes` / `teachers`. Written by Google sync (names already come from the Live Timetable since Operation 6) and by manual class add/edit on a shift.

Canonical directory: `dmc_classes` (32 rows) and `dmc_instructors` (37 rows), refreshed from the DMC API.

Name overlap with history is partial: of 31 distinct stored class names, 18 match a DMC class exactly once after case/punctuation folding. The rest are historic or renamed titles ("Absolute Beginners Barre" vs "Absolute Beginner Barre", "Glutes & Legs" vs "Glutes and Legs", "Back to Basics", "Pre-Production Meeting…"). Those get reported, never guessed.

## Phase A — schema and data migration

Migration adds `dmc_class_id` and `dmc_instructor_id` (nullable, foreign keys to the DMC tables, indexed) to `calendar_classes`. Entries inside `shifts.classes` gain optional `dmcClassId` / `dmcInstructorId` keys — no column change. Existing name columns stay for now.

One-time linking pass, exact matching only:

- Class: fold both sides to lowercase alphanumerics; link only on exactly one match.
- Instructor: fold `first_name || last_name`; link only on exactly one match.
- Zero or multiple matches: leave null, keep the original text.

## Phase B — consumers use the DMC references

- **Google sync**: the timetable resolver already produces the matched slot, so its DMC class and instructor ids are written alongside the display names. The validation path (date + Berlin start + duration -> slot) is unchanged.
- **Manual class on a shift** and **manual Record entry**: the two free-text pickers become DMC class and DMC instructor pickers backed by a new read-only DMC directory server function. The selected ids are stored, with the DMC names kept as the display snapshot.
- **No new dependency on `classes` / `teachers` is introduced.** New writes stop populating `class_id` / `teacher_id` and stop bumping those usage counters, so the legacy tables can actually become deletable.

## Phase C — dependency audit of the four legacy tables

For each of `classes`, `teachers`, `class_aliases`, `calendar_classes`, check both levels:

- application: every read, write, server function, UI surface, test
- database: foreign keys, functions (including `bump_directory_usage` and `rename_operator`), triggers, policies

Known starting points to resolve: the Admin Settings "Classes & Teachers" management section and the duplicate-name hygiene report both read `classes` / `teachers`; `calendar_classes` is read widely (shift overview, Studio Display, class lifecycle, shift deletion). The audit decides whether each of those is a genuine remaining responsibility or only leftover plumbing, including whether `calendar_classes` is still an application concept at all or merely old Google-matching storage.

## Phase D — conditional deletion

Each table gets an explicit verdict:

- safe (no application or database dependency, data no longer needed) -> delete it, with its dependent code and UI removed in the same operation
- not safe -> keep it untouched and state exactly which consumers require it

No table is deleted on assumption, and no table is preserved by default.

## Phase E — verification and reports

Two reports:

1. **Migration report**, row by row, not just totals: record, original class name, matched DMC class, original teacher name, matched DMC instructor, status (Migrated / Partial / Unmatched / Ambiguous). This is what lets historic records be resolved by hand later without any fuzzy matching.
2. **Table verdict report**: the four tables with DELETE or KEEP and the reason.

Checks: existing records display the same names as before, new records carry DMC ids, editing preserves them, Google sync still resolves through the Live Timetable, current-month manual sync and shift grouping unchanged, no fuzzy matcher and no `class_aliases` writes reintroduced. Then TypeScript, the full test suite (including new tests for the exact-match rule and its ambiguity/no-match rejections) and a production build.
