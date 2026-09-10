# Operation 10 — Simplify calendar_classes

Remove the three redundant text columns from the operational class table and resolve every class/instructor name through the official DMC directory instead.

## Audit findings (verified now)

Columns to drop are referenced in exactly these places:

- `src/lib/gcal.server.ts` — row type, insert during Google sync, manual add/update, and the shared select column lists (3 occurrences).
- `src/components/ShiftOverviewDialog.tsx` — displays and seeds the edit form.
- `src/components/ClassScheduleCard.tsx` — displays and seeds the edit form.
- `src/routes/index.tsx` — dashboard class rows and the record snapshot written at checkout.
- `src/integrations/supabase/types.ts` — generated types (regenerate after migration).

No other reference exists: not in Studio Display, calendar route, shift grouping, attendance, notifications, retention/pruning, tests, or any SQL/RPC string. Database side: no view, policy, trigger, index, or function depends on these three columns.

Data check: all 118 current rows already have both `dmc_class_id` and `dmc_instructor_id` set, so nothing loses its name in the migration.

## What changes

1. Migration drops `class_name`, `teacher_name`, `raw_title`. Everything else — `uid`, dates, times, status, shift link, both DMC foreign keys, indexes, trigger — stays untouched.
2. Server reads join the DMC tables and return `className` / `teacherName` alongside each row, so the app keeps showing the same names.
3. Google sync and manual class add/edit stop writing the removed fields; they already write the DMC IDs.
4. Dashboard, Shift Overview, and the class schedule card read the resolved names instead of the dropped columns.
5. Checkout snapshots keep storing class name, teacher name, and both DMC IDs in the record — history is unaffected.

## Null safety

A row whose DMC id is missing renders a neutral placeholder (`—`) and its editor opens with an empty selection. No fallback to any removed column, no re-introduction of name matching or the old directory tables.

## Technical notes

- New helper `resolveClassIdentities(rows)` in `src/domain/dmc-directory.server.ts`: one batched lookup of `dmc_classes` and `dmc_instructors` per read, mapped onto the returned rows. No per-row query.
- `CalendarClassRow` in `src/lib/gcal.server.ts` loses `class_name` / `teacher_name` / `raw_title` and gains resolved `className` / `teacherName`; the three shared select column lists shrink accordingly.
- `src/integrations/supabase/types.ts` regenerates after the migration runs.
- Operation 9 retention/pruning logic is not touched.

## Validation

Typecheck, full test suite, production build, plus a check that a Google sync still inserts and de-duplicates by `uid`, shift grouping and labels still work, and dashboard / calendar / shift overview / record / Studio Display still show the correct class and instructor. Final report will list the audit results and confirm zero remaining references to the three columns.
