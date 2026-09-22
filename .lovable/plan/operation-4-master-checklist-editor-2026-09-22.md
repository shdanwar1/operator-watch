# Operation 4 — Master Checklist Editor

Add an "Edit Checklists" section beneath the existing Checklist Records on the admin Checklists page, so the four master checklists can be edited, reordered, extended and trimmed. Records stay exactly as they are.

## What the admin will see

Below the existing records table, a compact list of four rows:

```text
EDIT CHECKLISTS
Start Shift Checklist   22 items            [Edit / Reorder]
Ballet Checklist        28 items            [Edit / Reorder]
Workout Checklist       25 items            [Edit / Reorder]
End Shift Checklist     10 items            [Edit / Reorder]
```

"Edit / Reorder" opens a dialog for that one checklist:

- Ordered list of items, each with a drag handle, up/down buttons, an Edit affordance and a Delete button.
- Item text edits happen inline in the row.
- Ballet and Workout rows also show the item's heading as a picker (10 Minutes Before Class, 5 Minutes Before Class, Class Starts, During the Class, End of Class, After the Class). Start Shift and End Shift show no heading control at all.
- "+ Add Item" adds a row (text, plus heading for Ballet/Workout) with a generated unique id.
- Delete asks for confirmation before removing.
- All changes are local draft state; nothing is written until Save. Cancel discards.
- On save failure the dialog stays open with the draft intact and an error plus retry; on success it closes, shows a short confirmation and the item count updates.

## Technical notes

- Data unchanged: master templates stay in `app_settings.operator_checklists`, snapshots stay in `shifts.checklists`. No new tables, no nesting — items remain one flat ordered array with optional `heading`.
- New pure module `src/domain/checklist-editor.ts`: draft operations (move up/down, move by index, edit text/heading, add with generated id, delete) and `validateChecklistTemplate` — non-empty unique ids, non-empty text, array shape, headings allowed only for ballet/workout. Shared by client and server so client-side validation is never the only check.
- New admin server functions in `src/lib/checklist-templates.functions.ts`:
  - `adminGetChecklistTemplates` — reads current config via the existing `readChecklistConfig`.
  - `adminUpdateChecklistTemplate({ type, title, items })` — requires admin session (same `requireAdmin` pattern as `settings.functions.ts`), validates type and items server-side, then writes only that one key inside `app_settings.operator_checklists`. Separate from the operator mutation; operators are rejected with 403.
- Historical isolation comes for free: the save only touches `app_settings`; no code path rewrites `shifts.checklists`. Open shifts keep their snapshot because `ensureChecklistsForShift` never re-snapshots an existing one. This is asserted by tests.
- Reordering uses native HTML5 drag-and-drop plus Move up / Move down buttons — no new dependency.
- New UI: `src/components/admin/ChecklistTemplateEditor.tsx` (dialog) and a small template list section rendered from `src/routes/admin.checklists.tsx`. Records components untouched.

## Verification

- Unit tests for the draft operations, validation rules, heading handling and historical isolation.
- Full test suite, typecheck, lint on changed files, production build.
- Live: sign in as admin (site password + admin PIN), edit/add/delete/reorder in each of the four editors, save, reload, confirm persistence and that Records still works; then sign in as the operator to confirm the open shift's checklist is unchanged and still behaves correctly, and confirm the operator cannot call the admin save.
