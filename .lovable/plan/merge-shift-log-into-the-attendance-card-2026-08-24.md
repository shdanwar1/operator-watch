# Merge Shift Log into the Attendance card

## Goal
The Record screen currently has two sections: **Attendance** (monthly totals + a history table of completed shifts) and **Shift Log** (a separate list with expandable class/notes details, plus Add/Edit/Delete). Merge the shift log's expandable detail into the attendance history rows so there is one combined card. Every attendance row gets a dropdown chevron; expanding it shows the classes and notes for that shift, plus Edit and Delete actions. The separate Shift Log section is removed.

## Changes

### 1. `src/lib/attendance.ts` — carry class/notes data into attendance rows
- Add `classes: ShiftClass[]` and `notes: string | null` to the `AttendanceRow` type.
- In `buildAttendanceRows`, copy `s.classes` and `s.notes` from each `ShiftRow` into the returned row (the data is already fetched by `listShifts`; it just isn't surfaced today).
- Import `ShiftClass` from `@/lib/shifts.functions`.

### 2. `src/components/record/AttendanceSection.tsx` — expandable rows + actions
- Pull in the shift-log capabilities that currently live in `ShiftLogSection`:
  - Server fns: `updateShift`, `deleteShift`, `createPastShift` via `useServerFn`.
  - Directory fns: `listTeachers`, `listClasses`, `recordDirectoryUsage` (for the Edit/Add dialogs' comboboxes).
  - Local state: `editing`, `addingPast`, teachers/classDir, plus the `saveEdit` / `deleteShift` / `addPast` / `recordShiftUsage` handlers (moved verbatim from `ShiftLogSection`).
- Add an `expanded: Record<string, boolean>` state + chevron toggle.
- **Desktop table**: add a narrow first column with a `ChevronDown` button per row. When expanded, render a second `<tr>` spanning all columns containing the class/teacher table, notes, and Edit/Delete buttons (reuse the exact markup from `ShiftLogSection`'s expand panel).
- **Mobile rows**: add a chevron to `AttendanceMobileRow`; when expanded, render the same class/notes + Edit/Delete panel beneath the row.
- Add the **Add past shift** button next to the "Attendance · {month}" header (where the Export PDF button lives).
- Render `<EditDialog>` and `<AddPastDialog>` at the bottom of the section (move these components into this file, or import from a shared module).

### 3. `src/routes/record.tsx` — drop the separate section
- Remove the `<ShiftLogSection>` import and its usage.
- Keep `<AttendanceSection username={username} />` as the only content under the header.

### 4. Cleanup
- Delete `src/components/record/ShiftLogSection.tsx` once its logic has been folded into `AttendanceSection` (Edit/Add dialogs, helpers `toLocalInput`/`fromLocalInput`/`duration`, and the `Shift` type move with it).
- Keep `ShiftClass` exported from `@/lib/shifts.functions` (already is).

## Notes / scope
- Attendance rows are completed shifts only (`check_out_at` set), matching today's behavior. Active shifts still surface on the Dashboard.
- Edit/Delete/Add-past all remain available, per the user's choice.
- No other UI (Dashboard, Studio Display, Admin) changes.
